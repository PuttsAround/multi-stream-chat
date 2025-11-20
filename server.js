const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const tmi = require('tmi.js');
const { KickWebSocket } = require('kick-wss');
const { TikTokLiveConnector } = require('tiktok-live-connector');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let twitchClient, kickChat, tiktokConnector, ytInterval;

// Function to (re)connect all platforms
function connectAll(twitch = '', youtube = '', kick = '', tiktok = '') {
  // Clean up old connections
  if (twitchClient) twitchClient.disconnect();
  if (kickChat) kickChat.disconnect();
  if (tiktokConnector) tiktokConnector.disconnect();
  if (ytInterval) clearInterval(ytInterval);

  // Twitch
  if (twitch) {
    twitchClient = new tmi.Client({ channels: [twitch.toLowerCase()] });
    twitchClient.connect().catch(() => {});
    twitchClient.on('message', (channel, tags, message) => {
      io.emit('message', {
        platform: 'twitch',
        user: tags['display-name'] || tags.username,
        message,
        color: tags.color || '#9146FF'
      });
    });
  }

  // Kick
  if (kick) {
    kickChat = new KickWebSocket({ debug: false });
    kickChat.connect(kick);
    kickChat.on('ChatMessage', data => {
      io.emit('message', { 
        platform: 'kick', 
        user: data.sender.username, 
        message: data.content, 
        color: '#00FF00' 
      });
    });
  }

  // TikTok
  if (tiktok) {
    tiktokConnector = new TikTokLiveConnector();
    tiktokConnector.connect(tiktok).catch(() => {});
    tiktokConnector.on('chat', data => {
      io.emit('message', { platform: 'tiktok', user: data.nickname, message: data.comment, color: '#FF0050' });
    });
  }

  // YouTube
  if (youtube) {
    let liveId = youtube;
    if (youtube.startsWith('@')) liveId = youtube.slice(1);
    if (youtube.startsWith('UC')) liveId = youtube;

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
      } catch (e) {
        console.error('YouTube fetch error:', e);
      }
    };

    fetchYouTube();
    ytInterval = setInterval(fetchYouTube, 6000);
  }
}

// Serve page and read channels from URL query
app.get('/', (req, res) => {
  const q = req.query;
  connectAll(q.twitch || '', q.youtube || '', q.kick || '', q.tiktok || '');
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Multi-stream chat running on port ${PORT}`));