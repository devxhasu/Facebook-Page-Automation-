# FB Shop Agent

Facebook page er jonno AI sales agent: Messenger + comment auto reply, order, payment verify, admin web panel.

## 1. MongoDB (free)
1. MongoDB Atlas e free cluster, ekta database user banan.
2. Network Access > Add IP > `0.0.0.0/0` (Render er IP change hoy).
3. Connection string niye shesh e database naam boshan:
   `mongodb+srv://USER:PASS@cluster0.xxxx.mongodb.net/fbshop?retryWrites=true&w=majority`

## 2. Render
1. Ei folder GitHub e push korun. Render > New > Web Service > repo select.
2. Build command `npm install`, Start command `npm start`.
3. Environment e shudhu ei 3 ta:
   - `ADMIN_PASSWORD` : panel er password
   - `MONGODB_URI`    : upore er string
   - `SECRET_KEY`     : boro random lekha (token encrypt hoy). Pore bodlale save kora key gulo abar dite hobe.
4. Baki shob (Facebook token, AI key, payment number...) panel theke.

## 3. UptimeRobot
HTTP monitor: `https://APP.onrender.com/health`, 5 minute por por.

## 4. Panel setup (https://APP.onrender.com)
1. Login > Settings > **AI providers**: OpenRouter key boshan (ek line e ekta key, ekadhik dile auto rotate). Test button chapun.
2. Settings > **Payment**: bKash/Nagad number, on/off switch. **Delivery**: charge.
3. Products e product add (chobi upload shoho). Test chat e AI er shathe kotha bole dekhun.

## 5. Facebook
1. developers.facebook.com > App > Messenger > Webhooks: Callback URL = panel Home e deya Webhook URL, Verify Token = panel er token.
2. Webhook fields: `messages`, `messaging_postbacks`, `feed`.
3. Page Access Token generate kore Settings > Facebook e boshan. Home > **Test connection**.
4. Permission lagbe: pages_messaging, pages_manage_metadata, pages_read_engagement, pages_manage_engagement. Live korte Facebook App Review lagte pare (nam ar niyom Facebook bodlate pare).
5. Comment er jonno kon post e kon product: Data > post_links.

## Extra (panel theke)
- **Login**: owner = username `admin` + `ADMIN_PASSWORD`. Settings > Admin accounts e staff account banan, prottekke alada permission.
- **Ekadhik page**: Settings > Facebook pages e aro page er token add korun. Ek webhook URL shob page e cholbe. Prottek page alada on/off.
- **Payment number**: Data > pay_methods e bKash/Nagad/Rocket jotoi number, prottekta alada on/off.
- **Bundle**: Data > bundles. **Coupon**: Data > coupons. **Comment post link**: Data > post_links.
- **Ticket**: AI complaint/return/exchange/refund niye ticket kore, Inbox e dekhben, ar customer ke reply pathate parben (Facebook 24 ghonta niyom).
- **Courier**: Settings e Steadfast ba Pathao key dile order e "Steadfast/Pathao te pathao" button ashe, delivered hole auto status.
- **Follow-up**: customer chup thakle (default 20 ghonta pore) ekbar nitibhabe jiggesh kore. Settings > Delivery ar selling theke off kora jay.
- Order e customer ke message na gele order e lal chinho ar Telegram/panel alert ashe, apni call korben.

## Notun feature (module)
`modules/<naam>/index.js` banan: `{ title, version, fields:[...settings], init(ctx){ ctx.router..., ctx.agent.registerTool(...), ctx.bus.on('order:status',...) } }`.
`modules/steadfast` dekhe nin. Core file e hat dite hoy na. Render e module deploy hoy git push diye.

## Error dekha
Render > Logs ar panel > Logs, duto jaygay ekoi line. Token/API key log e mask hoye ashe.
