/**
 * Modular AI Provider Manager
 * Supports multiple providers with failover, separate lists for text/vision/voice
 * Easy to add new providers later without touching core logic
 */

const axios = require('axios');
const { AiProvider, MessageLog } = require('../../models');
const { maskKey, sleep } = require('../../utils/helpers');
const logger = require('../log/logger');

class ProviderManager {
  constructor() {
    this.cache = { text: [], vision: [], voice: [] };
    this.lastRefresh = 0;
  }

  async refreshProviders() {
    const now = Date.now();
    if (now - this.lastRefresh < 30000 && this.cache.text.length) return; // 30s cache

    const providers = await AiProvider.find({ isActive: true }).sort({ sortOrder: 1 });
    
    this.cache = { text: [], vision: [], voice: [] };
    for (const p of providers) {
      if (this.cache[p.type]) {
        this.cache[p.type].push(p);
      }
    }
    this.lastRefresh = now;
  }

  async callText(messages, options = {}) {
    await this.refreshProviders();
    const list = this.cache.text;
    if (!list.length) {
      throw new Error('No active text AI provider configured');
    }

    let lastError = null;
    for (const provider of list) {
      for (const keySlot of provider.apiKeys.filter(k => k.isActive)) {
        try {
          const start = Date.now();
          const result = await this._callProvider(provider, keySlot, messages, options);
          const ms = Date.now() - start;

          await logger.log({
            type: 'provider',
            direction: 'out',
            content: `Text via ${provider.name}`,
            provider: provider.name,
            responseTimeMs: ms,
            tokens: result.usage?.total_tokens || 0,
            success: true,
            meta: { model: result.model, keySlot: keySlot.label }
          });

          // reset fail count
          keySlot.failCount = 0;
          keySlot.status = 'ok';
          keySlot.lastUsed = new Date();
          await provider.save();

          return {
            text: result.text,
            provider: provider.name,
            model: result.model,
            usage: result.usage,
            ms
          };
        } catch (err) {
          lastError = err;
          keySlot.failCount = (keySlot.failCount || 0) + 1;
          keySlot.status = 'error';
          await provider.save();

          await logger.log({
            type: 'provider',
            direction: 'out',
            content: `Failed ${provider.name}: ${err.message}`,
            provider: provider.name,
            success: false,
            error: err.message
          });

          // small delay before next try
          await sleep(300);
        }
      }
    }

    throw lastError || new Error('All text providers failed');
  }

  async callVision(imageUrl, prompt, options = {}) {
    await this.refreshProviders();
    const list = this.cache.vision;
    if (!list.length) {
      return { text: null, failed: true, reason: 'No vision provider' };
    }

    for (const provider of list) {
      for (const keySlot of provider.apiKeys.filter(k => k.isActive)) {
        try {
          const result = await this._callVisionProvider(provider, keySlot, imageUrl, prompt, options);
          return { text: result.text, provider: provider.name, failed: false };
        } catch (err) {
          await logger.log({
            type: 'provider',
            success: false,
            provider: provider.name,
            error: `Vision fail: ${err.message}`
          });
        }
      }
    }
    return { text: null, failed: true, reason: 'All vision providers failed' };
  }

  async _callProvider(provider, keySlot, messages, options) {
    const name = (provider.name || '').toLowerCase();

    if (name.includes('openrouter')) {
      return this._openRouter(keySlot.key, provider.model || 'openai/gpt-4o-mini', messages, provider.timeoutMs);
    }
    if (name.includes('gemini')) {
      return this._gemini(keySlot.key, provider.model || 'gemini-1.5-flash', messages, provider.timeoutMs);
    }
    if (name.includes('grok')) {
      return this._grok(keySlot.key, provider.model || 'grok-beta', messages, provider.timeoutMs);
    }
    if (provider.isBackup || name.includes('backup') || name.includes('custom')) {
      return this._customBackup(provider, keySlot, messages);
    }

    // generic OpenAI compatible
    return this._openAiCompatible(provider.baseUrl || 'https://api.openai.com/v1', keySlot.key, provider.model, messages, provider.timeoutMs);
  }

  async _openRouter(apiKey, model, messages, timeout = 15000) {
    const res = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages,
        temperature: 0.7,
        max_tokens: 600
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ai-sales-agent.local',
          'X-Title': 'AI Sales Agent'
        },
        timeout
      }
    );

    const choice = res.data.choices?.[0];
    return {
      text: choice?.message?.content || '',
      model: res.data.model,
      usage: res.data.usage
    };
  }

  async _gemini(apiKey, model, messages, timeout = 15000) {
    // Convert to Gemini format
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const systemInstruction = messages.find(m => m.role === 'system')?.content;

    const body = {
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await axios.post(url, body, { timeout });

    const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
      text,
      model,
      usage: res.data.usageMetadata || {}
    };
  }

  async _grok(apiKey, model, messages, timeout = 15000) {
    const res = await axios.post(
      'https://api.x.ai/v1/chat/completions',
      {
        model: model || 'grok-beta',
        messages,
        temperature: 0.7,
        max_tokens: 600
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout
      }
    );

    return {
      text: res.data.choices?.[0]?.message?.content || '',
      model: res.data.model,
      usage: res.data.usage
    };
  }

  async _customBackup(provider, keySlot, messages) {
    // Only for simple Q&A. Does NOT handle order logic.
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const question = lastUser?.content || '';
    
    // Safety: never send name/phone/address to backup
    const safeQuestion = question
      .replace(/01[3-9]\d{8}/g, '[phone]')
      .replace(/\d{4,}/g, '[number]');

    let url = (provider.baseUrl || keySlot.key || '').replace('{message}', encodeURIComponent(safeQuestion));
    
    const res = await axios.get(url, { timeout: provider.timeoutMs || 10000 });
    const field = provider.responseField || 'text';
    const text = res.data?.[field] || res.data?.text || res.data?.message || JSON.stringify(res.data);

    return {
      text: typeof text === 'string' ? text : 'আমি এখন উত্তর দিতে পারছি না, একটু পরে চেষ্টা করুন।',
      model: res.data?.model || 'backup',
      usage: res.data?.usage || {}
    };
  }

  async _openAiCompatible(baseUrl, apiKey, model, messages, timeout) {
    const res = await axios.post(
      `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      { model, messages, temperature: 0.7, max_tokens: 600 },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout
      }
    );
    return {
      text: res.data.choices?.[0]?.message?.content || '',
      model: res.data.model,
      usage: res.data.usage
    };
  }

  async _callVisionProvider(provider, keySlot, imageUrl, prompt, options) {
    // Simplified: only OpenRouter / Gemini style for now
    const name = (provider.name || '').toLowerCase();
    if (name.includes('openrouter') || name.includes('openai')) {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ];
      return this._openRouter(keySlot.key, provider.model || 'openai/gpt-4o-mini', messages, provider.timeoutMs);
    }
    // Gemini vision can be added similarly
    throw new Error('Vision not implemented for this provider yet');
  }
}

module.exports = new ProviderManager();
