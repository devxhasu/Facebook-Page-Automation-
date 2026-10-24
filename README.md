# AI Sales Agent for Facebook Page

**Full modular system** – Facebook Messenger + Comment Auto Reply + Order Management + Multi AI Provider + Full Control Web Panel.

কোনো ফিচার বাদ দেওয়া হয়নি। প্রজেক্টটা **মডুলার** করে বানানো হয়েছে যাতে পরে নতুন ফিচার সহজে যোগ করা যায়।

---

## Features (সবগুলো)

### AI Sales Agent
- মানুষের মতো ছোট ও স্বাভাবিক কথা (বাংলা / Banglish)
- অর্ডার ফ্লোতে মাঝপথে অন্য প্রশ্ন হ্যান্ডেল করে আবার অর্ডারে ফেরে
- জানা তথ্য আর দ্বিতীয়বার চায় না
- এক মেসেজে অনেক তথ্য একসাথে ধরে
- একই নামের প্রোডাক্টে গেস করে না (ইউনিক কোড + ভ্যারিয়েন্ট)
- Typing delay + short messages
- Human Takeover সাপোর্ট

### Payment & Fake Order Protection
- COD / Delivery Advance / Full Advance (Panel থেকে On/Off)
- AI নিজে Confirm করে না
- TrxID + Sender + Amount নিয়ে Verify Request
- শুধু Admin “Payment Received” দিলে Confirm
- Phone format check, daily limit, blacklist, new customer = advance

### Comment System
- কমেন্ট বুঝে পাবলিক ছোট রিপ্লাই + ইনবক্সে ডিটেইলস
- পোস্ট → প্রোডাক্ট লিংক
- স্প্যাম/ইমোজি স্কিপ

### Panel (Full Control)
- Dashboard, Orders, Products, Connections
- Unlimited Knowledge Base
- Payment Numbers (আনলিমিটেড)
- AI Providers (OpenRouter → Gemini → Grok → Backup)
- Live Logs (রং কোডসহ)
- Needs Attention
- Settings সব DB তে (env এ শুধু ৩টা)

### Technical
- Node.js + Express
- MongoDB (Atlas recommended)
- Official Facebook Graph API only
- Modular services (AI / Facebook / Order / Product / Log)
- Easy to extend

---

## Quick Start

### 1. Install
```bash
cd facebook-ai-sales-agent
npm install
```

### 2. Environment
```bash
cp .env.example .env
```
এডিট করো:
```
ADMIN_PASSWORD=your_strong_password
DATABASE_URL=mongodb+srv://...   # MongoDB Atlas free
SECRET_KEY=long_random_string_32chars_minimum
```

### 3. Run
```bash
npm start
# or
npm run dev
```

Panel: `http://localhost:3000`  
Login: `admin` + তোমার `ADMIN_PASSWORD`

### 4. Facebook Setup
1. [developers.facebook.com](https://developers.facebook.com) → App তৈরি
2. Messenger + Webhooks যোগ করো
3. Webhook URL: `https://your-domain.com/api/webhook`
4. Verify Token: `ai_sales_agent_verify_token_2024`
5. Page Access Token জেনারেট করে Panel → Connections এ পেস্ট করো

### 5. AI Providers
Panel → AI Providers অথবা সরাসরি MongoDB তে `aiproviders` কালেকশনে অ্যাড করো।

উদাহরণ (OpenRouter):
```js
{
  type: "text",
  name: "OpenRouter",
  model: "openai/gpt-4o-mini",
  apiKeys: [{ key: "sk-or-...", label: "main", isActive: true }],
  isActive: true,
  sortOrder: 1
}
```

---

## Project Structure (Modular)

```
src/
├── config/          → app config
├── models/          → all MongoDB schemas
├── routes/          → API endpoints
├── services/
│   ├── ai/          → ProviderManager + SalesAgent
│   ├── facebook/    → Messenger & Comment API
│   ├── order/       → (extendable)
│   ├── product/
│   ├── payment/
│   ├── notification/
│   └── log/
├── middleware/
├── utils/
└── public/          → Admin Panel (HTML/CSS/JS)
```

নতুন ফিচার যোগ করতে চাইলে শুধু সংশ্লিষ্ট `services/` ফোল্ডারে নতুন মডিউল বানিয়ে `routes` এ কানেক্ট করো। পুরো প্রজেক্ট এডিট করতে হবে না।

---

## Deploy (Render / Railway / VPS)

1. MongoDB Atlas ফ্রি ক্লাস্টার বানাও
2. Env ভেরিয়েবল সেট করো
3. Start command: `node src/server.js`
4. UptimeRobot দিয়ে `/health` পিং দাও (১৫ মিনিট স্লিপ এড়াতে)

---

## Important Notes

- **কোনো Appstate / Cookie ব্যবহার করা হয়নি** – শুধু Official Page Access Token
- AI কখনো নিজে অর্ডার Confirm করে না
- Backup API তে নাম/ফোন/ঠিকানা পাঠানো হয় না
- Live Logs এ API Key মাস্কড থাকে
- সব কনফিগ Panel / DB তে – কোডে হার্ডকোড নেই

---

## Next Easy Extensions

- Telegram notification module
- Steadfast / Pathao tracking
- Voice reply (TTS)
- Advanced bargain limit
- Coupon auto apply
- Multi-language system prompt

সবকিছু মডুলার রাখা হয়েছে যাতে এগুলো আলাদা করে যোগ করা যায়।

## Extra Improvements Included

- Order status by keyword **and** order ID (`#1042 koi?`)
- Budget mode (“1000 tk er moddhe”)
- Thank-you auto closing
- Risk-aware payment (new/risky customer → advance)
- Soft upsell hint in system prompt
- Incomplete address detection rule
- Low stock + Telegram notification module
- Status change auto message to customer
- Daily report helper
- Simple response cache utility
- Modular notification service
