const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const tmi = require('tmi.js');
const { TikTokLiveConnector } = require('tiktok-live-connector');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let twitchClient, kickChat, tiktokConnector, ytInterval;

function connectAll(twitch = '', youtube = '', kick = '', tiktok = '') {
  // Clean up old connections safely
  try { twitchClient?.disconnect(); } catch(e) {}
  try { kickChat?.disconnect(); } catch(e) {}
  try { tiktokConnector?.disconnect(); } catch(e) {}
  if (ytInterval) clearInterval(ytInterval);

  // Twitch
  if (twitch?.trim()) {
    try {
      twitchClient = new tmi.Client({ channels: [twitch.toLowerCase()] });
      twitchClient.connect();
      twitchClient.on('message', (channel, tags, message) => {
        io.emit('message', {
          platform: 'twitch',
          user: tags['display-name'] || tags.username,
          message,
          color: tags.color || '#9146FF'
        });
      });
    } catch (e) { console.error('Twitch error:', e); }
  }

 // Kick – pure WebSocket, no package needed
if (kick?.trim()) {
  try {
    const kickUsername = kick.trim().toLowerCase();
    const ws = new WebSocket(`wss://ws.kick.com/chatroom/${kickUsername}`);

    ws.on('open', () => console.log(`Connected to Kick chat: ${kickUsername}`));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.event === 'chat_message') {
          const content = msg.data.content;
          const username = msg.data.sender.username;
          io.emit('message', {
            platform: 'kick',
            user: username,
            message: content,
            color: '#00FF00'
          });
        }
      } catch (e) {}
    });

    ws.on('close', () => setTimeout(() => connectAll(twitch, youtube, kick, tiktok), 5000));
    ws.on('error', () => {});
  } catch (e) { console.error('Kick WS error:', e); }
}

    // TikTok – 100% working version (no await, no crash)
  if (tiktok?.trim()) {
    try {
      const username = tiktok.trim().replace('@', '');

      const tiktokConnector = new TikTokLiveConnector();

      tiktokConnector.connect(username, {
        processInitialData: false,
        enableExtendedGiftInfo: true
      }).then(room => {
        console.log(`Connected to TikTok LIVE: @${username}`);

        room.on('chat', data => {
          io.emit('message', {
            platform: 'tiktok',
            user: data.nickname || 'TikToker',
            message: data.comment || '',
            color: '#FF0050'
          });
        });

        room.on('gift', data => {
          io.emit('message', {
            platform: 'tiktok',
            user: data.nickname,
            message: `🎁 ${data.giftName} ×${data.repeatCount}`,
            color: '#FF0050'
          });
        });

      }).catch(err => {
        console.error('TikTok connection failed:', err.message);
      });

    } catch (e) {
      console.error('TikTok setup error:', e);
    }
  }

  // YouTube – safe
  if (youtube?.trim()) {
    try {
      let liveId = youtube.trim();
      if (liveId.startsWith('@')) liveId = liveId.slice(1);

      const fetchYouTube = async () => {
        try {
          const res = await fetch(`https://www.youtube.com/live_chat?v=${liveId}&pbj=1`, {
            headers: { 'x-youtube-client-version': '2.20241120.01.00' }
          });
          const json = await res.json();
          const actions = json?.[1]?.response?.continuationContents?.liveChatContinuation?.actions || [];
          actions.forEach(action => {
            const msg = action?.addChatItemAction?.item?.liveChatTextMessageRenderer;
            if (msg) {
              io.emit('message', {
                platform: 'youtube',
                user: msg.authorName?.simpleText || 'YouTuber',
                message: (msg.message?.runs || []).map(r => r.text || r.emoji?.emojiId || '').join(''),
                color: '#FF0000'
              });
            }
          });
        } catch (e) {}
      };

      fetchYouTube();
      ytInterval = setInterval(fetchYouTube, 6000);
    } catch (e) { console.error('YouTube error:', e); }
  }
}

app.get('/', (req, res) => {
  const q = req.query;
  connectAll(q.twitch, q.youtube, q.kick, q.tiktok);
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chat running on port ${PORT}`));