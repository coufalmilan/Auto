// AutoAnalýza AI — Cloudflare Worker (Gemini v8 - omezený CORS)

const GEMINI_API_KEY = 'VLOZ_SEM_SVUJ_KLIC'; // ← tvůj klíč z aistudio.google.com

// ─── CORS: povol POUZE tyto domény ────────────────────────────────────────────
// Přidej sem svoji Netlify URL (a případně vlastní doménu).
const ALLOWED_ORIGINS = [
  'https://YOUR-SITE.netlify.app',       // ← změň na svoji Netlify URL
  // 'https://autoanalyza.vasedomena.cz', // vlastní doména (volitelné)
];
// ─────────────────────────────────────────────────────────────────────────────

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(requestOrigin),
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, getCorsHeaders(requestOrigin));
    }

    // Odmítni požadavky z nepovolených domén (ochrana před zneužitím API klíče)
    if (requestOrigin && !ALLOWED_ORIGINS.includes(requestOrigin)) {
      return jsonResponse({ error: 'Forbidden' }, 403, getCorsHeaders(requestOrigin));
    }

    try {
      const body = await request.json();
      const prompt = body.prompt;
      if (!prompt) return jsonResponse({ error: 'Chybí prompt' }, 400, getCorsHeaders(requestOrigin));

      const geminiBody = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          response_mime_type: 'application/json',
          thinkingConfig: { thinkingBudget: 0 }
        },
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });

      const data = await resp.json();

      if (data.error) {
        return jsonResponse({ error: `Gemini: ${data.error.message} (code: ${data.error.code})` }, 500, getCorsHeaders(requestOrigin));
      }

      // Seberi všechny textové parts
      let text = '';
      try {
        for (const part of data.candidates[0].content.parts) {
          if (part.text) text += part.text;
        }
      } catch(e) {
        return jsonResponse({ error: 'Neočekávaná odpověď: ' + JSON.stringify(data).substring(0, 400) }, 500, getCorsHeaders(requestOrigin));
      }

      // Vyčisti případné zbytky markdownu
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

      // Najdi JSON objekt
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) {
        return jsonResponse({ error: 'JSON nenalezen. Preview: ' + text.substring(0, 300) }, 500, getCorsHeaders(requestOrigin));
      }
      text = text.substring(start, end + 1);

      // Sanitizuj kontrolní znaky uvnitř string hodnot (záloha)
      text = sanitizeJsonString(text);

      // Parsuj a znovu serializuj pro čistý výstup
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch(e) {
        return jsonResponse({
          error: 'Gemini nevrátil validní JSON: ' + e.message + ' | Preview: ' + text.substring(0, 300)
        }, 500, getCorsHeaders(requestOrigin));
      }

      return jsonResponse({ text: JSON.stringify(parsed) }, 200, getCorsHeaders(requestOrigin));

    } catch (err) {
      return jsonResponse({ error: err.message }, 500, getCorsHeaders(requestOrigin));
    }
  }
};

function sanitizeJsonString(str) {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);

    if (escape) {
      result += ch;
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      result += ch;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      if (code === 0x0A) { result += '\\n'; continue; }
      if (code === 0x0D) { result += '\\r'; continue; }
      if (code === 0x09) { result += '\\t'; continue; }
      if (code < 0x20) { continue; }
    }

    result += ch;
  }

  return result;
}

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    }
  });
}
