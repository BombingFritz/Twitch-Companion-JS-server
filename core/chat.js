// Kern: Chat-Versand und Absender je Chat-Funktion (ADR 0027, Schritt 3b; ADR 0017, Spec bot-account.md).
// Welche Chat-Funktionen es gibt (features) und ihre Vorgaben gibt server.js mit; der Kern kennt keine Funktion selbst.
'use strict';
const fs = require('fs');

// ctx: config (CHAT_SENDERS_FILE, CHAT_SENDER_VALUES, CHAT_MAX_CHARS, PORT), features { key: Name }, defaults { key: 'bot' },
//      logPrefixes { key: '[Präfix] ' } für Logzeilen beim Versand,
//      auth (loadTokens, getValidAccessToken, loadBotConfig, twitchApi), onBotMessageSent() z. B. Statistik
function createChat(ctx) {
  const { config: c, features, defaults, auth } = ctx;

  // Fehlende oder defekte Datei, fehlender oder unbekannter Eintrag: Vorgabe aus defaults, sonst Broadcaster
  function loadChatSenders() {
    const senders = Object.fromEntries(Object.keys(features).map(f => [f, defaults[f] || 'broadcaster']));
    if (!fs.existsSync(c.CHAT_SENDERS_FILE)) return senders;
    try {
      const data = JSON.parse(fs.readFileSync(c.CHAT_SENDERS_FILE, 'utf8'));
      for (const f of Object.keys(senders)) if (c.CHAT_SENDER_VALUES.includes(data[f])) senders[f] = data[f];
    } catch { /* defekte Datei: Vorgaben */ }
    return senders;
  }

  function saveChatSenders(senders) {
    fs.writeFileSync(c.CHAT_SENDERS_FILE, JSON.stringify(senders, null, 2), 'utf8');
  }

  let chatSenders = loadChatSenders();
  let botLastError = null;            // { at, text } – letzter Fehler beim Senden über den Bot

  // Eingestellter Absender einer Funktion ('bot' oder 'broadcaster'), unabhängig davon, ob ein Bot eingerichtet ist
  function senderOf(feature) {
    return chatSenders[feature];
  }

  // Rückgabe: true, wenn sich etwas geändert hat; Prüfung von feature und sender beim Aufrufer
  function setChatSender(feature, sender, source) {
    if (chatSenders[feature] === sender) return false;
    chatSenders = { ...chatSenders, [feature]: sender };
    saveChatSenders(chatSenders);
    const botHint = sender === 'bot' && !auth.loadBotConfig() ? ' (noch kein Bot eingerichtet – bis dahin sendet der Broadcaster)' : '';
    console.log(`[Bot] ${source}: ${features[feature]} sendet jetzt ${sender === 'bot' ? 'der Bot' : 'der Broadcaster'}${botHint}`);
    return true;
  }

  function botFeatures() {
    return Object.keys(features).filter(f => chatSenders[f] === 'bot');
  }

  function botFeatureLabels() {
    const list = botFeatures().map(f => features[f]);
    return list.length ? list.join(', ') : 'nichts';
  }

  function chatSenderList() {
    return Object.keys(features).map(feature => ({ feature, name: features[feature], sender: chatSenders[feature] }));
  }

  function printChatSenders() {
    for (const { feature, name, sender } of chatSenderList()) console.log(`[Bot]   ${feature.padEnd(10)} ${name}: ${sender === 'bot' ? 'Bot' : 'Broadcaster'}`);
  }

  function printBotStatus() {
    const bot = auth.loadBotConfig();
    if (!bot) {
      console.log(`[Bot] Nicht eingerichtet – alle Nachrichten kommen vom Broadcaster. Einrichten: /mod DerBdu im Chat, dann http://localhost:${c.PORT}/login-bot in einem Browser, in dem DerBdu bei Twitch angemeldet ist`);
      return;
    }
    console.log(`[Bot] ${bot.bot_name || bot.bot_login} (ID ${bot.bot_id}), freigegeben am ${new Date(bot.authorized_at).toLocaleString('de-DE')}`);
    console.log(`[Bot] Sendet: ${botFeatureLabels()}; alles andere sendet der Broadcaster (umstellen: bot sender <funktion> bot|broadcaster)`);
    console.log(`[Bot] Letzter Sendefehler: ${botLastError ? `${new Date(botLastError.at).toLocaleString('de-DE')} – ${botLastError.text}` : 'keiner'}`);
  }

  function clearBotLastError() {
    botLastError = null;
  }

  function checkChatSendResult(response, message, logPrefix) {
    const result = response?.data?.data?.[0];
    if (result && result.is_sent === false) {
      console.warn(`${logPrefix}Twitch hat die Nachricht nicht gesendet (${result.drop_reason?.message || 'ohne Grund'}): ${message}`);
      return false;
    }
    return true;
  }

  // Ergebnis: true/false (Twitch hat geantwortet; bei is_sent:false kein Rückfall, damit der Broadcaster keine Filter umgeht)
  // oder 'fallback' (HTTP-Fehler, Broadcaster soll senden).
  async function sendChatMessageAsBot(bot, message, replyToMessageId, logPrefix) {
    const tokens = auth.loadTokens();
    if (!tokens) return 'fallback';
    const body = { broadcaster_id: tokens.broadcaster_id, sender_id: bot.bot_id, message };
    if (replyToMessageId) body.reply_parent_message_id = replyToMessageId;
    try {
      // App-Token; bei 401 holt twitchApi einmal einen neuen (abgelaufen oder widerrufen)
      const response = await auth.twitchApi.post('/chat/messages', body, { auth: 'app', headers: { 'Content-Type': 'application/json' } });
      const sent = checkChatSendResult(response, message, logPrefix);
      if (sent) ctx.onBotMessageSent();
      return sent;
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.message || err.message;
      const hint = status === 403 ? ' – Ist DerBdu Moderator (/mod DerBdu) und ist die Freigabe noch gültig (/login-bot)?' : '';
      botLastError = { at: Date.now(), text: `${status || 'kein HTTP-Status'}: ${detail}` };
      console.warn(`${logPrefix}Senden über den Bot ${bot.bot_login} fehlgeschlagen (${status || '-'}: ${detail})${hint} – sende als Broadcaster`);
      return 'fallback';
    }
  }

  // Postet eine Chat-Nachricht; mit replyToMessageId als Antwort auf diese Chat-Nachricht. Über CHAT_MAX_CHARS wird gekürzt.
  // Absender der Funktion feature ist der Bot und der Bot ist eingerichtet: über den Bot (App-Token, ADR 0017),
  // bei HTTP-Fehler Rückfall auf den Broadcaster.
  // Sonst als Broadcaster. Fehler werden geloggt; Rückgabe true, wenn Twitch die Nachricht angenommen hat.
  // options.broadcasterPrefix: nur beim Versand als Broadcaster vor den Text setzen (Absenderangabe, z. B. "FT vom BdU: ").
  async function sendChatMessage(text, replyToMessageId = null, feature = null, options = {}) {
    const cut = t => (t.length > c.CHAT_MAX_CHARS ? t.slice(0, c.CHAT_MAX_CHARS - 1) + '…' : t);
    const logPrefix = (ctx.logPrefixes || {})[feature] || '';
    const bot = feature && chatSenders[feature] === 'bot' ? auth.loadBotConfig() : null;
    if (bot) {
      const result = await sendChatMessageAsBot(bot, cut(text), replyToMessageId, logPrefix);
      if (result !== 'fallback') return result;
    }
    const message = cut((options.broadcasterPrefix || '') + text);
    try {
      await auth.getValidAccessToken();
      const tokens = auth.loadTokens();
      const body = { broadcaster_id: tokens.broadcaster_id, sender_id: tokens.broadcaster_id, message };
      if (replyToMessageId) body.reply_parent_message_id = replyToMessageId;
      const response = await auth.twitchApi.post('/chat/messages', body, { headers: { 'Content-Type': 'application/json' } });
      return checkChatSendResult(response, message, logPrefix);
    } catch (err) {
      console.error(`${logPrefix}Fehler beim Senden in den Chat:`, err.response?.data || err.message, '– Text:', message);
      return false;
    }
  }

  return {
    sendChatMessage, senderOf, setChatSender, chatSenderList, botFeatures, botFeatureLabels,
    printChatSenders, printBotStatus, clearBotLastError,
  };
}

module.exports = { createChat };
