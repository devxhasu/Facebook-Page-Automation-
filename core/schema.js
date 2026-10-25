// Settings form definition (the panel renders forms from this; modules add their own section)
const B = (k, l, h) => ({ k, l, t: 'bool', h });
const T = (k, l, h) => ({ k, l, t: 'text', h });
const N = (k, l, h) => ({ k, l, t: 'num', h });
const A = (k, l, h) => ({ k, l, t: 'area', h });
const X = (k, l, h) => ({ k, l, t: 'secret', h });
const SEL = (k, l, o, h) => ({ k, l, t: 'select', o, h });

module.exports = [
  { id: 'bot', title: 'Bot control', fields: [
    B('bot_on', 'Bot chalu (master switch)'), B('messenger_on', 'Messenger auto reply'), B('comment_on', 'Comment auto reply'),
    T('bot_off_message', 'Bot off thakle customer ke ki bolbe'),
    B('hours_on', 'Shomoy onujayi AI chalabo'), T('hours_start', 'Shuru (HH:MM, Dhaka time)'), T('hours_end', 'Shesh (HH:MM)'), T('outside_hours_message', 'Shomoyer baire ki bolbe'),
    N('human_pause_min', 'Pause AI korle koto minute', 'Inbox theke nijer haate chat korle AI ei shomoy chup thakbe'),
  ] },
  { id: 'persona', title: 'AI er kothar dhoron', fields: [
    T('persona_name', 'AI er naam'), T('page_name', 'Page/shop er naam'),
    SEL('reply_lang', 'Reply er bhasha', ['auto', 'banglish', 'bangla', 'english'], 'auto = customer ja likhe sei bhashay uttor dey. banglish = Bangla + English mix (English okkhore Bangla). bangla = Bangla okkhore. english = shudhu English'),
    SEL('greeting_style', 'Greeting', ['auto', 'salam', 'hello', 'none']), SEL('tone', 'Tone', ['friendly', 'formal']), SEL('emoji_level', 'Emoji', ['none', 'low']),
    T('delivery_time', 'Delivery shomoy (customer ke bolbe)'), B('typing_delay', 'Typing dekhabe + ektu deri kore reply'),
  ] },
  { id: 'fb', title: 'Facebook connection', fields: [
    X('fb_page_token', 'Page Access Token'), T('fb_app_id', 'App ID', 'Token meyad dekhar jonno (optional)'), X('fb_app_secret', 'App Secret', 'Webhook signature check er jonno (recommended)'),
    T('fb_greeting_text', 'Messenger greeting (chat shuru r age, max 160 okkhor)', 'Home > Messenger menu setup chaple Facebook e set hobe'), T('fb_verify_token', 'Webhook Verify Token', 'Facebook Developer e ei token-i boshan'), T('public_url', 'Public URL (optional)', 'Render e auto ashe. Onno jaygay hole https://... likhun'),
  ] },
  { id: 'ai', title: 'AI providers', fields: [
    T('ai_text_order', 'Text order', 'openrouter,gemini,grok,custom'), T('ai_vision_order', 'Chobi order', 'openrouter,gemini,grok'), T('ai_voice_order', 'Voice (ekhon shudhu gemini)'),
    B('openrouter_on', 'OpenRouter chalu'), X('openrouter_keys', 'OpenRouter keys (ek line e ekta)'), T('openrouter_model', 'OpenRouter model'),
    B('gemini_on', 'Gemini chalu'), X('gemini_keys', 'Gemini keys'), T('gemini_model', 'Gemini model'),
    B('grok_on', 'Grok chalu'), X('grok_keys', 'Grok (xAI) keys'), T('grok_model', 'Grok model'),
    B('custom_on', 'Backup API chalu (shudhu text)'), X('custom_url', 'Backup API URL', '{message} likhe message er jaygay'), T('custom_path', 'Response e uttor kon field e', 'jemon: text'),
    B('vision_on', 'Chobi bujha'), B('voice_on', 'Voice bujha'), N('voice_max_mb', 'Voice max size (MB)'),
    N('ai_daily_token_limit', 'Daily token limit (0 = limit nai)'), T('ai_fail_message', 'Shob AI fail korle customer ke ki bolbe'),
  ] },
  { id: 'pay', title: 'Payment ar order niyom', fields: [
    B('pay_cod', 'Cash on Delivery'), B('pay_delivery_adv', 'Delivery charge advance'), B('pay_full_adv', 'Full advance'),
    A('pay_numbers', 'Fallback payment number (Data > pay_methods khali thakle eta dekhabe)', 'Ek line e ekta: bKash: 017... (Personal)'), A('pay_note', 'Payment instruction'),
    B('new_customer_cod', 'Notun customer COD pabe'), N('trusted_after', 'Koto ta delivered order er por COD trusted', 'Trusted na hole COD pabe na (notun customer COD off thakle)'),
    N('auto_cancel_hours', 'Payment na dile koto ghonta pore auto cancel (0 = off)'), N('max_orders_per_day', 'Ek customer er ekdin e max order'),
  ] },
  { id: 'sales', title: 'Delivery ar selling', fields: [
    N('delivery_inside', 'Dhaka er vitore delivery charge'), N('delivery_outside', 'Dhaka er baire delivery charge'), N('free_delivery_min', 'Free delivery (koto takar upore, 0 = off)'),
    N('max_discount_pct', 'AI shorbocho koto % discount dite parbe'), B('upsell_on', 'Free delivery nudge / upsell'), N('low_stock', 'Stock koto ta er niche hole alert ar AI "X ta baki" bolte parbe'),
    B('follow_up_on', '24 ghontar moddhe ekbar follow-up ("ekhono nite chan?")'), N('follow_up_hours', 'Customer chup thakle koto ghonta pore follow-up (max 23)'), B('image_match_on', 'Customer er chobi catalog er chobir shathe milabe'),
  ] },
  { id: 'faq', title: 'Common proshno (AI nijei uttor dey)', fields: [
    B('faq_on', 'Delivery/COD/payment/size er proshno server nijei uttor dibe'),
    A('size_guide', 'Size guide (ek line e ekta size)', 'Jemon:\nS: 45-55 kg, 150-160 cm\nM: 55-65 kg, 160-168 cm\nL: 65-75 kg, 168-175 cm'),
    A('return_policy', 'Return/exchange niyom (customer jiggesh korle eta-i bolbe)'), A('trust_text', 'Trust uttor ("original ki?", "thokabe na to?")'), A('shop_address', 'Shop er address/location'),
  ] },
  { id: 'smart', title: 'Smart selling', fields: [
    B('bargain_on', 'Dam komanor kotha hole shorbocho discount porjonto dibe (Delivery ar selling > max discount)'), B('combo_offer_on', 'Combo offer ache hole ekbar bolbe'), B('cart_reminder_on', 'Order preview dekhiye chup thakle reminder'),
    B('review_on', 'Delivery r 2 din por review chaibe'), N('review_coupon_pct', 'Review message e porer order er discount % (0 = off)'), B('live_track_on', 'Order koi? te courier er live status bolbe'),
    B('abuse_guard_on', 'Gali dile shanto uttor + admin alert'), B('risk_guard_on', 'Fake/shondehojonok order dhorbe (COD hole admin approval lagbe)'), N('vip_spent', 'VIP tag: koto taka kena hole (delivered)'), B('takeover_on', 'Admin inbox e likhle AI nijei pause hobe'),
    SEL('after_hours_mode', 'Off time e', ['take_orders', 'message'], 'take_orders = order nibe, admin shokal e confirm korbe. message = shudhu "off" message'),
  ] },
  { id: 'comments', title: 'Comment reply', fields: [
    B('comment_poll_on', 'Comment auto khuje ber korbe (webhook na ashleo kaj kore)'), B('comment_public_reply', 'Public reply dibe'), B('comment_private_reply', 'Inbox e private reply dibe'), B('comment_price_public', 'Public reply te dam bolbe'),
    N('comment_delay_min', 'Reply delay min (sec)'), N('comment_delay_max', 'Reply delay max (sec)'), B('comment_hide_abusive', 'Gali/abusive comment auto hide'), B('comment_hide_spam', 'Link/spam comment auto hide'), B('comment_auto_link', 'Post er lekha theke product auto link'),
  ] },
  { id: 'notify', title: 'Notification', fields: [
    B('tg_on', 'Telegram notification'), X('tg_token', 'Telegram Bot Token'), T('tg_chat', 'Telegram Chat ID'),
    T('tg_events', 'Kon kon event (khali = shob)', 'order_new, order_approval, payment_review, order_cancel, attention, ticket, system, low_stock, daily_report'), B('daily_report', 'Roj raat 10 tay daily report'), B('weekly_report', 'Shonibar raat 10 tay 7 diner report'),
  ] },
  { id: 'img', title: 'Image hosting', fields: [ X('imgbb_key', 'ImgBB API key (free)', 'Khali thakle chobi MongoDB te save hobe') ] },
];
