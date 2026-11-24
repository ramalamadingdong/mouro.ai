// mouro.ai analytics — loads the self-hosted Umami tracker (https://mouro.ai/stats).
//
// Every page (the site and each game) includes this one file by its absolute
// address, so the website ID and the clean-up below live in one place.
//
// Umami sets no cookies and stores no IP addresses. On top of that:
//   - only the live site is counted (dev servers and previews are ignored);
//   - query strings are never sent;
//   - room codes in game URLs (/holdem/game/K7QX2) are replaced with ":code",
//     so the dashboard groups every room together and no code is recorded.
// Never send location or anything typed by a player in an event.
(function () {
  if (location.hostname !== 'mouro.ai') return;

  var ROOM = /\/(join|lobby|game)\/[A-HJKMNP-Z2-9]{5}(?=\/|\?|#|$)/gi;
  var clean = function (u) {
    return typeof u === 'string' ? u.replace(ROOM, '/$1/:code') : u;
  };

  window.mouroStatsBeforeSend = function (type, payload) {
    if (payload) {
      payload.url = clean(payload.url);
      payload.referrer = clean(payload.referrer);
    }
    return payload;
  };

  var s = document.createElement('script');
  s.defer = true;
  s.src = 'https://mouro.ai/stats/script.js';
  s.setAttribute('data-website-id', '709b4612-3276-4021-898d-46d6bb41419b');
  s.setAttribute('data-domains', 'mouro.ai');
  s.setAttribute('data-exclude-search', 'true');
  s.setAttribute('data-before-send', 'mouroStatsBeforeSend');
  document.head.appendChild(s);
})();
