// Language layer for every message the SERVER writes (the AI follows the same setting through its prompt).
// reply_lang setting: auto (mirror the customer) | banglish | bangla | english.
// Each text has 3 variants: bl = Banglish (Bangla in English letters, also the "mix"), bn = Bangla script, en = English.
// A text may be an array: one variant is picked at random so the shop never sounds like a robot.
const S = require('./settings');

const D = {};
function add(dict) { for (const [k, v] of Object.entries(dict)) D[k] = v; }

const BN = /[ঀ-৿]/;
const EN_WORDS = new Set('the is are was i you we it to a an of for and or my me your do does did have has had want need like how much what when where which who why can could will would please price size color colour order delivery cash home address phone number name available stock buy get send show tell give hi hello thanks thank ok okay yes no not this that these those there here with without about from our shop product products pay payment money discount offer return exchange real original quality'.split(' '));
const BL_MARK = new Set('ache achhe lagbe laagbe koto kot dam daam ki kemon kivabe kothay kobe nibo nite den dao dite korben korbo koren hobe hoy hoyeche amar amr ami apni apnar eta ota ei oi ta ti na hya ji jii bhai vai apu thik thikache ekta dui tin char pabo pawa jabe pathan pathao dekhan dekhao dekhaben bolen bolun bolo jonno er ke theke diye niye moddhe baire vitore'.split(' '));

// what language is this customer writing in? 'bn' | 'en' | 'bl' | '' (unsure)
function detect(text) {
  const t = String(text || '');
  if (BN.test(t)) return 'bn';
  const ws = t.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!ws.length) return '';
  const bl = ws.filter((w) => BL_MARK.has(w)).length;
  const en = ws.filter((w) => EN_WORDS.has(w)).length;
  if (bl > 0) return 'bl';
  if (en >= 2 && en >= ws.length * 0.5) return 'en';
  return ws.length >= 2 ? 'bl' : '';
}
// remember the customer's language on their record (used when reply_lang = auto)
function learn(c, text) {
  const d = detect(text);
  if (d && c && c.lang !== d) { c.lang = d; return d; }
  return '';
}
function langOf(c) {
  const f = String(S.get('reply_lang') || 'auto');
  if (f === 'bangla') return 'bn';
  if (f === 'english') return 'en';
  if (f === 'banglish') return 'bl';
  const l = c && (typeof c === 'string' ? c : c.lang);
  return ['bn', 'en', 'bl'].includes(l) ? l : 'bl';
}
const LANG_NAME = { bn: 'Bangla (Bengali script)', en: 'English', bl: 'Banglish (Bangla written in English letters, mixed with common English words)' };

const pick = (a) => (Array.isArray(a) ? a[Math.floor(Math.random() * a.length)] : a);
function t(key, c, vars = {}) {
  const e = D[key];
  if (!e) return key;
  const l = langOf(c);
  const s = pick(e[l] != null ? e[l] : e.bl);
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? '' : vars[k]));
}
// all variants of a key in every language (to build regexes / compare button labels)
const variants = (key) => { const e = D[key] || {}; return [].concat(e.bl || [], e.bn || [], e.en || []); };
const money = (n, c) => {
  const v = Math.round(Number(n) || 0).toLocaleString('en-US');
  return langOf(c) === 'bn' ? v + ' টাকা' : v + ' tk';
};
// list: "a, b ba c"
const list = (arr, c) => { const a = arr.filter(Boolean); if (a.length < 2) return a[0] || ''; const w = { bl: ' ba ', bn: ' বা ', en: ' or ' }[langOf(c)]; return a.slice(0, -1).join(', ') + w + a[a.length - 1]; };

// ---------------- base texts ----------------
add({
  'g.salam': { bl: 'Walaikum assalam ji', bn: 'ওয়ালাইকুম আসসালাম জি', en: 'Walaikum assalam' },
  'g.assalam': { bl: 'Assalamu alaikum', bn: 'আসসালামু আলাইকুম', en: 'Assalamu alaikum' },
  'g.hello': { bl: 'Hello ji', bn: 'হ্যালো জি', en: 'Hello' },
  'g.fine': { bl: ', alhamdulillah bhalo', bn: ', আলহামদুলিল্লাহ ভালো', en: ', doing well' },
  'g.new': {
    bl: ['{shop} e shagotom! Ki khujchhen, bolun ji.', '{shop} e shagotom! Apni ki dekhte chan ji?', 'Shagotom {shop} e! Kon product ta lagbe, bolun ji.'],
    bn: ['{shop} এ স্বাগতম! কী খুঁজছেন, বলুন জি।', '{shop} এ স্বাগতম! আপনি কী দেখতে চান জি?', 'স্বাগতম {shop} এ! কোন প্রোডাক্টটা লাগবে বলুন জি।'],
    en: ['Welcome to {shop}! What are you looking for?', 'Welcome to {shop}! What would you like to see?'],
  },
  'g.back': {
    bl: ['Abar {shop} e shagotom! Ki lagbe bolun ji.', 'Abar peye bhalo laglo ji! Ki lagbe?'],
    bn: ['আবার {shop} এ স্বাগতম! কী লাগবে বলুন জি।', 'আবার পেয়ে ভালো লাগলো জি! কী লাগবে?'],
    en: ['Welcome back to {shop}! What do you need?', 'Good to see you again! What can I get you?'],
  },
  'g.recent': { bl: ['Bolun ji, ki lagbe?', 'Ji bolun, ki dekhabo?'], bn: ['বলুন জি, কী লাগবে?', 'জি বলুন, কী দেখাবো?'], en: ['Tell me, what do you need?', 'Sure, what can I show you?'] },

  'need.name': { bl: 'naam', bn: 'নাম', en: 'name' },
  'need.phone': { bl: 'phone number', bn: 'ফোন নাম্বার', en: 'phone number' },
  'need.address': { bl: 'puro address', bn: 'পুরো ঠিকানা', en: 'full address' },

  's.oos': { bl: 'Ji, {name} ekhon stock e nai. Onno kichu dekhabo?', bn: 'জি, {name} এখন স্টকে নেই। অন্য কিছু দেখাবো?', en: 'Sorry, {name} is out of stock right now. Shall I show you something else?' },
  's.low': { bl: ' Matro {n} ta baki ache.', bn: ' মাত্র {n}টা বাকি আছে।', en: ' Only {n} left.' },
  's.first': { bl: 'Ji, {name}, {price}.{low} {opt} ki nibo?', bn: 'জি, {name}, {price}।{low} কোন {opt} নিবেন?', en: '{name} is {price}.{low} Which {opt} would you like?' },
  's.next': {
    bl: ['Darun. {opt} ki nibo?', 'Thik ache ji. {opt} ta bolun?', 'Bujhlam ji. {opt} ki hobe?'],
    bn: ['দারুণ। কোন {opt} নিবেন?', 'ঠিক আছে জি। {opt} টা বলুন?'],
    en: ['Great. Which {opt}?', 'Got it. Which {opt} would you like?'],
  },
  's.details': {
    bl: ['Darun ji! {summary}. Nite apnar {need} ek sathe din ji.', 'Perfect ji! {summary}. Order korte apnar {need} ek sathe likhe din.'],
    bn: ['দারুণ জি! {summary}। নিতে আপনার {need} একসাথে দিন জি।', 'পারফেক্ট জি! {summary}। অর্ডার করতে আপনার {need} একসাথে লিখে দিন।'],
    en: ['Great! {summary}. To place the order, please send your {need} in one message.', 'Perfect! {summary}. Please send your {need} together so I can place it.'],
  },
  's.same_addr': { bl: 'Darun ji! {summary}. Ager moto {phone}, {address} e pathabo?', bn: 'দারুণ জি! {summary}। আগের মতো {phone}, {address} এ পাঠাবো?', en: 'Great! {summary}. Send it to the same {phone}, {address} as before?' },
  'qr.addr_ok': { bl: 'Hya, ei ta', bn: 'হ্যাঁ, এটাই', en: 'Yes, same' },
  'qr.addr_new': { bl: 'Notun address', bn: 'নতুন ঠিকানা', en: 'New address' },
  's.new_addr': { bl: 'Thik ache ji, notun address ta likhun.', bn: 'ঠিক আছে জি, নতুন ঠিকানাটা লিখুন।', en: 'Sure, please type the new address.' },
  's.zone': { bl: 'Apnar address ki Dhaka shohorer moddhe?', bn: 'আপনার ঠিকানা কি ঢাকা শহরের মধ্যে?', en: 'Is your address inside Dhaka city?' },
  'qr.zone_in': { bl: 'Dhaka-r moddhe', bn: 'ঢাকার মধ্যে', en: 'Inside Dhaka' },
  'qr.zone_out': { bl: 'Dhaka-r baire', bn: 'ঢাকার বাইরে', en: 'Outside Dhaka' },
  's.cancel': { bl: 'Thik ache ji, onno kichu lagle bolben.', bn: 'ঠিক আছে জি, অন্য কিছু লাগলে বলবেন।', en: 'No problem. Tell me if you need anything else.' },
  's.many': { bl: '{n} ta ache ji. Kon ta nibo? "Eta nibo" chapun ba number likhun.', bn: '{n}টা আছে জি। কোনটা নিবেন? "এটা নিবো" চাপুন বা নাম্বার লিখুন।', en: 'We have {n} options. Which one would you like? Tap "Eta nibo" or type the number.' },
  's.bad_opt': { bl: 'Ei {opt} ta nai ji. Ache: {values}. Kon ta nibo?', bn: 'এই {opt} টা নেই জি। আছে: {values}। কোনটা নিবেন?', en: 'We do not have that {opt}. Available: {values}. Which one?' },
  's.oos_qty': { bl: 'Dukkhito ji, {name} ekhon matro {n} ta ache. Koyta nibo?', bn: 'দুঃখিত জি, {name} এখন মাত্র {n}টা আছে। কয়টা নিবেন?', en: 'Sorry, only {n} of {name} left. How many would you like?' },
  'qr.pick': { bl: 'Eta nibo', bn: 'এটা নিবো', en: 'Eta nibo' },

  'o.hishab': { bl: 'Apnar order er hishab:', bn: 'আপনার অর্ডারের হিসাব:', en: 'Your order summary:' },
  'o.bundle': { bl: 'Bundle offer:', bn: 'বান্ডেল অফার:', en: 'Bundle offer:' },
  'o.discount': { bl: 'Discount:', bn: 'ডিসকাউন্ট:', en: 'Discount:' },
  'o.delivery': { bl: 'Delivery charge:', bn: 'ডেলিভারি চার্জ:', en: 'Delivery charge:' },
  'o.total': { bl: 'Mot:', bn: 'মোট:', en: 'Total:' },
  'o.name': { bl: 'Naam:', bn: 'নাম:', en: 'Name:' },
  'o.phone': { bl: 'Phone:', bn: 'ফোন:', en: 'Phone:' },
  'o.address': { bl: 'Address:', bn: 'ঠিকানা:', en: 'Address:' },
  'o.confirm_line': { bl: 'Shob thik thakle "confirm" likhun.', bn: 'সব ঠিক থাকলে "কনফার্ম" লিখুন।', en: 'If everything is correct, reply "confirm".' },
  'qr.confirm': { bl: 'Confirm', bn: 'কনফার্ম', en: 'Confirm' },
  'qr.change': { bl: 'Change korbo', bn: 'পরিবর্তন করবো', en: 'Change' },
  'o.tip_free': { bl: 'Aro {gap} er product nile delivery free hobe ji.', bn: 'আরও {gap} এর প্রোডাক্ট নিলে ডেলিভারি ফ্রি হবে জি।', en: 'Add {gap} more to get free delivery.' },
  'o.confirmed_h': { bl: 'Order #{id} confirm hoyeche', bn: 'অর্ডার #{id} কনফার্ম হয়েছে', en: 'Order #{id} is confirmed' },
  'o.paid': { bl: 'Paid:', bn: 'পরিশোধ:', en: 'Paid:' },
  'o.due': { bl: 'Delivery te dite hobe:', bn: 'ডেলিভারির সময় দিতে হবে:', en: 'To pay on delivery:' },
  'o.dtime': { bl: 'Delivery shomoy:', bn: 'ডেলিভারির সময়:', en: 'Delivery time:' },
  'o.track_hint': { bl: 'Order er status jante likhun: "amar order koi?"', bn: 'অর্ডারের স্ট্যাটাস জানতে লিখুন: "আমার অর্ডার কই?"', en: 'To check the status, type: "where is my order?"' },
  'o.total2': { bl: 'Total:', bn: 'মোট:', en: 'Total:' },
  'o.delivery2': { bl: 'Delivery:', bn: 'ডেলিভারি:', en: 'Delivery:' },

  'p.got': { bl: 'Order #{id} peyechi ji. {amount} {method} e Send Money korun:', bn: 'অর্ডার #{id} পেয়েছি জি। {amount} {method} এ Send Money করুন:', en: 'Got order #{id}. Please Send Money {amount} via {method}:' },
  'p.got_plain': { bl: 'Order #{id} peyechi. Confirm korte {amount} pathan:', bn: 'অর্ডার #{id} পেয়েছি। কনফার্ম করতে {amount} পাঠান:', en: 'Got order #{id}. To confirm, please send {amount}:' },
  'p.send_trx': { bl: 'Pathiye TrxID likhe din (ba je number theke pathalen tar last 4 digit).', bn: 'পাঠিয়ে TrxID লিখে দিন (বা যে নাম্বার থেকে পাঠালেন তার শেষ ৪ ডিজিট)।', en: 'After sending, type the TrxID (or the last 4 digits of the number you sent from).' },
  'p.send_trx2': { bl: 'Pathiye shudhu TrxID ar je number theke pathalen ta likhe din.', bn: 'পাঠিয়ে শুধু TrxID আর যে নাম্বার থেকে পাঠালেন তা লিখে দিন।', en: 'After sending, just type the TrxID and the number you sent from.' },
  'p.thanks': { bl: ['Dhonnobad ji, payment er request peyechi. Admin verify korle order confirm hoye jabe.', 'Dhonnobad ji, payment er request peyechi. Admin check korei order confirm kore dibe.'], bn: ['ধন্যবাদ জি, পেমেন্টের রিকোয়েস্ট পেয়েছি। অ্যাডমিন ভেরিফাই করলে অর্ডার কনফার্ম হয়ে যাবে।'], en: ['Thank you, I have your payment request. The order will be confirmed once the admin verifies it.'] },
  'p.review': { bl: 'Order #{id} er payment admin verify korche ji, shighroi janabo.', bn: 'অর্ডার #{id} এর পেমেন্ট অ্যাডমিন ভেরিফাই করছে জি, শীঘ্রই জানাবো।', en: 'The admin is verifying the payment for order #{id}. I will update you soon.' },
  'p.advance': { bl: 'Order confirm korte age {amount} advance dite hobe ji. {methods} kon ta e dibena?{extra}', bn: 'অর্ডার কনফার্ম করতে আগে {amount} অগ্রিম দিতে হবে জি। {methods} কোনটাতে দিবেন?{extra}', en: 'To confirm the order, an advance of {amount} is needed. Which will you use: {methods}?{extra}' },
  'p.extra_full': { bl: ' (Chaile puro {total}-o dite paren)', bn: ' (চাইলে পুরো {total}-ও দিতে পারেন)', en: ' (You can also pay the full {total} if you prefer.)' },
  'p.pending': { bl: 'Order #{id} peyechi ji. Admin confirm korle janiye dibo.', bn: 'অর্ডার #{id} পেয়েছি জি। অ্যাডমিন কনফার্ম করলে জানিয়ে দিবো।', en: 'Got order #{id}. I will let you know once the admin confirms it.' },
  'p.need': { bl: 'Apnar {what} ta din ji.', bn: 'আপনার {what} টা দিন জি।', en: 'Please send your {what}.' },

  'st.pending': { bl: 'Order #{id} admin er approval er opekkhay ache ji.', bn: 'অর্ডার #{id} অ্যাডমিনের অ্যাপ্রুভালের অপেক্ষায় আছে জি।', en: 'Order #{id} is waiting for admin approval.' },
  'st.awaiting_payment': { bl: 'Order #{id} e {amount} advance dile order confirm hobe ji.', bn: 'অর্ডার #{id} এ {amount} অগ্রিম দিলে অর্ডার কনফার্ম হবে জি।', en: 'Order #{id} will be confirmed once you pay the {amount} advance.' },
  'st.payment_review': { bl: 'Order #{id} er payment admin verify korche ji, shighroi confirm hobe.', bn: 'অর্ডার #{id} এর পেমেন্ট অ্যাডমিন ভেরিফাই করছে জি, শীঘ্রই কনফার্ম হবে।', en: 'The payment for order #{id} is being verified; it will be confirmed shortly.' },
  'st.confirmed': { bl: 'Order #{id} confirm, ready kora hocche ji. Delivery {time}.', bn: 'অর্ডার #{id} কনফার্ম, রেডি করা হচ্ছে জি। ডেলিভারি {time}।', en: 'Order #{id} is confirmed and being prepared. Delivery: {time}.' },
  'st.shipped': { bl: 'Order #{id} pathano hoyeche ji.{track}', bn: 'অর্ডার #{id} পাঠানো হয়েছে জি।{track}', en: 'Order #{id} has been shipped.{track}' },
  'st.delivered': { bl: 'Order #{id} delivered hoyeche ji. Dhonnobad.', bn: 'অর্ডার #{id} ডেলিভারি হয়েছে জি। ধন্যবাদ।', en: 'Order #{id} has been delivered. Thank you!' },
  'st.cancelled': { bl: 'Order #{id} cancel kora hoyeche ji.', bn: 'অর্ডার #{id} ক্যান্সেল করা হয়েছে জি।', en: 'Order #{id} has been cancelled.' },
  'st.returned': { bl: 'Order #{id} return hishebe dhora hoyeche ji.', bn: 'অর্ডার #{id} রিটার্ন হিসেবে ধরা হয়েছে জি।', en: 'Order #{id} is marked as returned.' },
  'n.shipped': { bl: 'Apnar order #{id} pathano hoyeche.{track}', bn: 'আপনার অর্ডার #{id} পাঠানো হয়েছে।{track}', en: 'Your order #{id} has been shipped.{track}' },
  'n.delivered': { bl: 'Order #{id} delivered hoyeche. Dhonnobad.', bn: 'অর্ডার #{id} ডেলিভারি হয়েছে। ধন্যবাদ।', en: 'Order #{id} has been delivered. Thank you!' },
  'n.cancelled': { bl: 'Order #{id} cancel kora hoyeche.{refund}', bn: 'অর্ডার #{id} ক্যান্সেল করা হয়েছে।{refund}', en: 'Order #{id} has been cancelled.{refund}' },
  'n.refund': { bl: ' Advance er refund niye admin apnar shathe jogajog korbe.', bn: ' অগ্রিমের রিফান্ড নিয়ে অ্যাডমিন আপনার সাথে যোগাযোগ করবে।', en: ' The admin will contact you about the refund.' },
  'n.returned': { bl: 'Order #{id} return hishebe nothibhukto hoyeche.', bn: 'অর্ডার #{id} রিটার্ন হিসেবে নথিভুক্ত হয়েছে।', en: 'Order #{id} is recorded as returned.' },
  'n.pay_bad': { bl: 'Apnar payment verify kora jayni. Shothik TrxID ar number abar likhe din.', bn: 'আপনার পেমেন্ট ভেরিফাই করা যায়নি। সঠিক TrxID আর নাম্বার আবার লিখে দিন।', en: 'We could not verify your payment. Please send the correct TrxID and number again.' },
});

module.exports = { add, t, variants, money, list, detect, learn, langOf, LANG_NAME, pick, BN };
