// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: connection statuses, the result of the test button, the widget.
// German says "du", Spanish "usted", like Gladys. Model names are never
// translated.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // connection status and test action
  statusNoKey: {
    en: 'No Groq API key: create one on console.groq.com/keys and paste it in the configuration.',
    fr: 'Pas de clé d’API Groq : créez-en une sur console.groq.com/keys et collez-la dans la configuration.',
    de: 'Kein Groq-API-Schlüssel: Erstelle einen auf console.groq.com/keys und füge ihn in die Konfiguration ein.',
    es: 'No hay clave de API de Groq: cree una en console.groq.com/keys y péguela en la configuración.',
  },
  statusBadKey: {
    en: 'Groq refused the API key: check it, or create a new one on console.groq.com/keys.',
    fr: 'Groq a refusé la clé d’API : vérifiez-la, ou créez-en une nouvelle sur console.groq.com/keys.',
    de: 'Groq hat den API-Schlüssel abgelehnt: Prüfe ihn oder erstelle einen neuen auf console.groq.com/keys.',
    es: 'Groq ha rechazado la clave de API: compruébela o cree una nueva en console.groq.com/keys.',
  },
  statusSpendLimit: {
    en: 'The spending limit of the Groq organization is reached: raise it in Settings, Billing, Limits on console.groq.com, or wait for the 1st of the month.',
    fr: 'La limite de dépense de l’organisation Groq est atteinte : relevez-la dans Settings, Billing, Limits sur console.groq.com, ou attendez le 1er du mois.',
    de: 'Das Ausgabelimit der Groq-Organisation ist erreicht: Erhöhe es unter Settings, Billing, Limits auf console.groq.com oder warte bis zum 1. des Monats.',
    es: 'Se ha alcanzado el límite de gasto de la organización de Groq: auméntelo en Settings, Billing, Limits en console.groq.com o espere al día 1 del mes.',
  },
  statusNoModel: {
    en: '{model} is not available to this Groq key (wrong id, retired model or model blocked for the project): choose another model.',
    fr: '{model} n’est pas disponible pour cette clé Groq (identifiant faux, modèle retiré ou bloqué pour le projet) : choisissez un autre modèle.',
    de: '{model} ist für diesen Groq-Schlüssel nicht verfügbar (falsche ID, eingestelltes Modell oder für das Projekt gesperrt): Wähle ein anderes Modell.',
    es: '{model} no está disponible para esta clave de Groq (identificador erróneo, modelo retirado o bloqueado para el proyecto): elija otro modelo.',
  },
  statusNoCustom: {
    en: 'A model is set to “Other model” but the model id field is empty or invalid.',
    fr: 'Un modèle est réglé sur « Autre modèle » mais le champ de l’identifiant est vide ou invalide.',
    de: 'Ein Modell steht auf „Anderes Modell“, aber das Feld der Modell-ID ist leer oder ungültig.',
    es: 'Un modelo está en «Otro modelo» pero el campo del identificador está vacío o no es válido.',
  },
  statusPreview: {
    en: '{model} is a preview model: Groq may remove it at short notice.',
    fr: '{model} est un modèle en préversion : Groq peut le retirer sans long préavis.',
    de: '{model} ist ein Vorschaumodell: Groq kann es kurzfristig entfernen.',
    es: '{model} es un modelo en versión preliminar: Groq puede retirarlo con poco aviso.',
  },
  statusFlex: {
    en: 'Flex tier: higher limits, but a request fails at once when Groq is busy. It needs a paid plan.',
    fr: 'Niveau flex : limites plus hautes, mais une requête échoue aussitôt quand Groq est chargé. Il demande une offre payante.',
    de: 'Flex-Stufe: höhere Limits, aber eine Anfrage scheitert sofort, wenn Groq ausgelastet ist. Sie erfordert einen kostenpflichtigen Tarif.',
    es: 'Nivel flex: límites más altos, pero una solicitud falla al momento cuando Groq está saturado. Requiere un plan de pago.',
  },
  statusRateLimited: {
    en: 'Groq rate limit reached (requests or tokens per minute or per day): try again later, or move to the Developer plan.',
    fr: 'Limite de Groq atteinte (requêtes ou jetons par minute ou par jour) : réessayez plus tard, ou passez à l’offre Developer.',
    de: 'Groq-Limit erreicht (Anfragen oder Tokens pro Minute oder pro Tag): Versuche es später erneut oder wechsle zum Developer-Tarif.',
    es: 'Se ha alcanzado el límite de Groq (solicitudes o tokens por minuto o por día): inténtelo más tarde o pase al plan Developer.',
  },
  statusTooLarge: {
    en: 'A request of the assistant is bigger than the tokens per minute of the Groq plan (8,000 on the free plan): lower the maximum answer length, or move to the Developer plan.',
    fr: 'Une requête de l’assistant dépasse les jetons par minute de l’offre Groq (8 000 avec l’offre gratuite) : baissez la longueur maximale d’une réponse, ou passez à l’offre Developer.',
    de: 'Eine Anfrage des Assistenten ist größer als die Tokens pro Minute des Groq-Tarifs (8.000 im kostenlosen Tarif): Senke die maximale Antwortlänge oder wechsle zum Developer-Tarif.',
    es: 'Una solicitud del asistente supera los tokens por minuto del plan de Groq (8000 en el plan gratuito): reduzca la longitud máxima de respuesta o pase al plan Developer.',
  },
  statusUnreachable: {
    en: 'Cannot reach api.groq.com: check the internet access of Gladys.',
    fr: 'Impossible de joindre api.groq.com : vérifiez l’accès Internet de Gladys.',
    de: 'api.groq.com ist nicht erreichbar: Prüfe den Internetzugang von Gladys.',
    es: 'No se puede acceder a api.groq.com: compruebe el acceso a Internet de Gladys.',
  },
  statusApiError: {
    en: 'Groq error: {detail}',
    fr: 'Erreur de Groq : {detail}',
    de: 'Groq-Fehler: {detail}',
    es: 'Error de Groq: {detail}',
  },
  statusInitFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
    de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Protokolle der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  role_chat: { en: 'Chat', fr: 'Discussion', de: 'Chat', es: 'Chat' },
  role_router: { en: 'Router', fr: 'Routeur', de: 'Router', es: 'Enrutador' },
  testAnswered: {
    en: '{model} answered in {seconds} s.',
    fr: '{model} a répondu en {seconds} s.',
    de: '{model} hat in {seconds} s geantwortet.',
    es: '{model} ha respondido en {seconds} s.',
  },
  testRequestsLeft: {
    en: '{left} of {limit} requests left today.',
    fr: 'Il reste {left} requêtes sur {limit} aujourd’hui.',
    de: 'Heute noch {left} von {limit} Anfragen.',
    es: 'Quedan {left} de {limit} solicitudes hoy.',
  },

  // widget
  widgetNoKey: {
    en: 'No Groq API key yet: add it in the configuration of the integration, then choose Groq in Settings, Artificial Intelligence.',
    fr: 'Pas encore de clé d’API Groq : ajoutez-la dans la configuration de l’intégration, puis choisissez Groq dans Paramètres, Intelligence artificielle.',
    de: 'Noch kein Groq-API-Schlüssel: Füge ihn in der Konfiguration der Integration hinzu und wähle dann Groq unter Einstellungen, Künstliche Intelligenz.',
    es: 'Todavía no hay clave de API de Groq: añádala en la configuración de la integración y luego elija Groq en Ajustes, Inteligencia artificial.',
  },
  tileRequestsToday: {
    en: 'Requests today',
    fr: 'Appels du jour',
    de: 'Anfragen heute',
    es: 'Solicitudes hoy',
  },
  tileTokensToday: {
    en: 'Tokens today',
    fr: 'Jetons du jour',
    de: 'Tokens heute',
    es: 'Tokens hoy',
  },
  tileTokensMonth: {
    en: 'Month tokens',
    fr: 'Jetons du mois',
    de: 'Monats-Tokens',
    es: 'Tokens del mes',
  },
  tileErrorsToday: {
    en: 'Errors today',
    fr: 'Erreurs du jour',
    de: 'Fehler heute',
    es: 'Errores hoy',
  },
  tileRequestsLeft: {
    en: 'Left today',
    fr: 'Restant du jour',
    de: 'Heute übrig',
    es: 'Quedan hoy',
  },
  chartTokensTitle: {
    en: 'Thousands of tokens per day',
    fr: 'Milliers de jetons par jour',
    de: 'Tausend Tokens pro Tag',
    es: 'Miles de tokens por día',
  },
  chartTokensSeries: { en: 'Tokens', fr: 'Jetons', de: 'Tokens', es: 'Tokens' },
  rowState: { en: 'Groq', fr: 'Groq', de: 'Groq', es: 'Groq' },
  stateOk: { en: 'Answering', fr: 'Répond', de: 'Antwortet', es: 'Responde' },
  stateNoKey: {
    en: 'No API key',
    fr: 'Pas de clé d’API',
    de: 'Kein API-Schlüssel',
    es: 'Sin clave de API',
  },
  stateFailing: {
    en: 'Failing since {time}',
    fr: 'En erreur depuis {time}',
    de: 'Fehler seit {time}',
    es: 'Con errores desde {time}',
  },
  rowModels: { en: 'Models', fr: 'Modèles', de: 'Modelle', es: 'Modelos' },
  rowLastRequest: {
    en: 'Last request',
    fr: 'Dernière requête',
    de: 'Letzte Anfrage',
    es: 'Última solicitud',
  },
  valueLastRequest: {
    en: '{use}, {ago}',
    fr: '{use}, {ago}',
    de: '{use}, {ago}',
    es: '{use}, {ago}',
  },
  valueLastRequestTime: {
    en: '{use}, {ago} ({seconds} s)',
    fr: '{use}, {ago} ({seconds} s)',
    de: '{use}, {ago} ({seconds} s)',
    es: '{use}, {ago} ({seconds} s)',
  },
  rowLastError: {
    en: 'Last error',
    fr: 'Dernière erreur',
    de: 'Letzter Fehler',
    es: 'Último error',
  },
  buttonLimits: {
    en: 'GroqCloud limits',
    fr: 'Limites GroqCloud',
    de: 'GroqCloud-Limits',
    es: 'Límites GroqCloud',
  },
  use_chat: { en: 'chat', fr: 'discussion', de: 'Chat', es: 'chat' },
  use_router: { en: 'router', fr: 'routeur', de: 'Router', es: 'enrutador' },
  use_digest: {
    en: 'weekly digest',
    fr: 'résumé hebdo',
    de: 'Wochenrückblick',
    es: 'resumen semanal',
  },
  use_web: { en: 'web search', fr: 'recherche web', de: 'Websuche', es: 'búsqueda web' },
  kind_auth: {
    en: 'key refused',
    fr: 'clé refusée',
    de: 'Schlüssel abgelehnt',
    es: 'clave rechazada',
  },
  kind_spend_limit: {
    en: 'spending limit',
    fr: 'limite de dépense',
    de: 'Ausgabelimit',
    es: 'límite de gasto',
  },
  kind_model: {
    en: 'model unavailable',
    fr: 'modèle indisponible',
    de: 'Modell nicht verfügbar',
    es: 'modelo no disponible',
  },
  kind_rate_limit: {
    en: 'rate limit',
    fr: 'limite de requêtes',
    de: 'Anfragelimit',
    es: 'límite de solicitudes',
  },
  kind_too_large: {
    en: 'request too large',
    fr: 'requête trop grosse',
    de: 'Anfrage zu groß',
    es: 'solicitud muy grande',
  },
  kind_request: {
    en: 'request refused',
    fr: 'requête refusée',
    de: 'Anfrage abgelehnt',
    es: 'solicitud rechazada',
  },
  kind_server: {
    en: 'Groq error',
    fr: 'erreur de Groq',
    de: 'Groq-Fehler',
    es: 'error de Groq',
  },
  kind_unreachable: {
    en: 'unreachable',
    fr: 'injoignable',
    de: 'nicht erreichbar',
    es: 'inaccesible',
  },
  kind_timeout: { en: 'too slow', fr: 'trop lent', de: 'zu langsam', es: 'demasiado lento' },

  // durations
  never: { en: 'Never', fr: 'Jamais', de: 'Nie', es: 'Nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: {
    en: '{n} days ago',
    fr: 'il y a {n} jours',
    de: 'vor {n} Tagen',
    es: 'hace {n} días',
  },
};

/**
 * @description Whether a value is a language of the integration.
 * @param {unknown} value - The value.
 * @returns {boolean} True for en, fr, de, es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language, with its values.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The values of the `{placeholders}`.
 * @returns {string} The text, the key itself when unknown.
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string|Function} key - A TEXTS key, or `(language) => text`.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function'
        ? key(language)
        : t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description How long ago an instant was: "just now", "12 min ago", "3 h ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) {
    return t('never', language);
  }
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return t('justNow', language);
  }
  if (minutes < 60) {
    return t('minutesAgo', language, { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return t('hoursAgo', language, { n: hours });
  }
  return t('daysAgo', language, { n: Math.floor(hours / 24) });
}

/**
 * @description A number in the format of a language.
 * @param {number} value - The number.
 * @param {string} language - The language.
 * @param {number} [decimals] - The decimals at most.
 * @returns {string} "12,5" in French.
 */
function formatNumber(value, language, decimals = 1) {
  if (!Number.isFinite(value)) {
    return '–';
  }
  return new Intl.NumberFormat(isLanguage(language) ? language : 'en', {
    maximumFractionDigits: decimals,
  }).format(value);
}

export { LANGUAGES, TEXTS, isLanguage, t, all, ago, formatNumber };
