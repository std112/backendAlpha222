require('dotenv').config();
const express = require('express');
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const SteamTotp = require('steam-totp');

const app = express();
const client = new SteamUser();
const community = new SteamCommunity();
const manager = new TradeOfferManager({
  steam: client,
  community,
  language: 'en'
});

app.use(bodyParser.json());

client.logOn({
  accountName: process.env.BOT_USERNAME,
  password: process.env.BOT_PASSWORD,
  twoFactorCode: SteamTotp.generateAuthCode(process.env.BOT_SHARED_SECRET)
});

client.on('loggedOn', () => {
  console.log('✅ Bot logged in');
});

client.on('webSession', (sessionID, cookies) => {
  manager.setCookies(cookies);
  community.setCookies(cookies);
  community.startConfirmationChecker(10000, process.env.BOT_IDENTITY_SECRET);
});

function isValidItem(item) {
  const tags = item.tags.map(tag => tag.name);
  return (
    tags.includes('Unusual') ||
    tags.includes('Strange') ||
    tags.includes('Tool') ||
    tags.includes('Taunt') ||
    tags.includes('Festivized') ||
    item.name.includes('Paint')
  );
}

app.post('/api/submit-appeal', async (req, res) => {
  const { description, tradeUrl } = req.body;

  if (!tradeUrl || !tradeUrl.startsWith('https://')) {
    return res.status(400).json({ success: false, message: 'Invalid trade URL' });
  }

  const partner = TradeOfferManager.getPartnerID64(tradeUrl);

  manager.getUserInventoryContents(partner, 440, 2, true, (err, inventory) => {
    if (err) return res.status(500).json({ success: false, message: 'Inventory fetch failed' });

    const filteredItems = inventory.filter(isValidItem);

    if (filteredItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No tradable items matched.' });
    }

    const offer = manager.createOffer(tradeUrl);
    filteredItems.forEach(item => offer.addTheirItem(item));

    offer.setMessage(description || 'Appeal item validation');
    offer.send((err, status) => {
      if (err) return res.status(500).json({ success: false, message: 'Offer failed to send' });

      if (status === 'pending') {
        fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `⚠️ Trade offer NOT sent due to 15-day hold.

👤 Steam Profile: https://steamcommunity.com/profiles/${partner}
🔗 Trade URL: ${tradeUrl}`
          })
        });

        return res.status(400).json({ success: false, message: 'Trade would be held for 15 days. Offer not sent.' });
      }

      fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `🎯 New Trade Offer Sent

👤 Steam Profile: https://steamcommunity.com/profiles/${partner}
🔗 Trade URL: ${tradeUrl}
📦 Items Offered: ${filteredItems.length}
📝 Items: ${filteredItems.map(i => i.name).join(', ')}`
        })
      });

      res.json({ success: true, itemsCount: filteredItems.length });
    });

    offer.on('accepted', () => {
      fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `✅ Offer accepted by user: https://steamcommunity.com/profiles/${partner}` })
      });
    });

    offer.on('declined', () => {
      fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `❌ Offer declined by user: https://steamcommunity.com/profiles/${partner}` })
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
