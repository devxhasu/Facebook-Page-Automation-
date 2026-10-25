// Messenger profile: Get Started button, greeting text and the persistent menu.
const S = require('./settings');
const fb = require('./facebook');
const L = require('./logger');

async function setup() {
  const shop = S.get('page_name') || 'amader shop';
  const greeting = String(S.get('fb_greeting_text') || '').trim() || `Assalamu alaikum! ${shop} e shagotom. Shuru korte "Get Started" chapun.`;
  const body = {
    get_started: { payload: 'GET_STARTED' },
    greeting: [{ locale: 'default', text: greeting.slice(0, 160) }],
    persistent_menu: [{ locale: 'default', composer_input_disabled: false, call_to_actions: [
      { type: 'postback', title: 'Product dekhi', payload: 'MENU_PRODUCTS' },
      { type: 'postback', title: 'Order track', payload: 'MENU_TRACK' },
      { type: 'postback', title: 'Delivery info', payload: 'MENU_DELIVERY' },
      { type: 'postback', title: 'Admin er shathe kotha', payload: 'MENU_ADMIN' },
    ] }],
  };
  await fb.graph('me/messenger_profile', { method: 'POST', body });
  L.ok('facebook', 'Messenger menu + Get Started button set hoyeche');
  return true;
}
module.exports = { setup };
