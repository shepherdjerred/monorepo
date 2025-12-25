/**
 * Icon Name to Discord Emoji Mapping
 * Maps common icon names to Discord-compatible emoji
 */

const iconToEmoji: Record<string, string> = {
  // Status icons
  "check-circle": "✅",
  "check": "✓",
  "x-circle": "❌",
  "x": "✕",
  "alert-circle": "⚠️",
  "alert-triangle": "⚠️",
  "info": "ℹ️",
  "help-circle": "❓",

  // Navigation
  "arrow-left": "⬅️",
  "arrow-right": "➡️",
  "arrow-up": "⬆️",
  "arrow-down": "⬇️",
  "chevron-left": "◀️",
  "chevron-right": "▶️",
  "chevron-up": "🔼",
  "chevron-down": "🔽",
  "external-link": "🔗",

  // Actions
  "plus": "➕",
  "minus": "➖",
  "edit": "✏️",
  "trash": "🗑️",
  "copy": "📋",
  "save": "💾",
  "download": "⬇️",
  "upload": "⬆️",
  "refresh": "🔄",
  "search": "🔍",
  "filter": "🔍",
  "settings": "⚙️",
  "more-horizontal": "•••",
  "more-vertical": "⋮",

  // Objects
  "file": "📄",
  "folder": "📁",
  "image": "🖼️",
  "video": "🎬",
  "music": "🎵",
  "calendar": "📅",
  "clock": "🕐",
  "bell": "🔔",
  "mail": "📧",
  "message": "💬",
  "user": "👤",
  "users": "👥",
  "home": "🏠",
  "star": "⭐",
  "heart": "❤️",
  "bookmark": "🔖",
  "lock": "🔒",
  "unlock": "🔓",
  "key": "🔑",
  "shield": "🛡️",

  // Media controls
  "play": "▶️",
  "pause": "⏸️",
  "stop": "⏹️",
  "skip-forward": "⏭️",
  "skip-back": "⏮️",
  "volume": "🔊",
  "volume-x": "🔇",

  // Weather / nature
  "sun": "☀️",
  "moon": "🌙",
  "cloud": "☁️",
  "zap": "⚡",

  // Symbols
  "circle": "⚪",
  "square": "⬜",
  "triangle": "🔺",
  "diamond": "💎",

  // Technology
  "code": "💻",
  "terminal": "💻",
  "database": "🗄️",
  "globe": "🌐",
  "wifi": "📶",
  "bluetooth": "📶",

  // Misc
  "gift": "🎁",
  "tag": "🏷️",
  "flag": "🚩",
  "map-pin": "📍",
  "thumbs-up": "👍",
  "thumbs-down": "👎",
  "sparkles": "✨",
  "fire": "🔥",
  "rocket": "🚀",
  "lightbulb": "💡",
  "target": "🎯",
  "trophy": "🏆",
};

/**
 * Convert an icon name to a Discord emoji
 * Falls back to a generic indicator if not found
 */
export function iconToDiscordEmoji(iconName: string): string {
  // Normalize the icon name (lowercase, handle common variations)
  const normalized = iconName.toLowerCase().replace(/_/g, "-");

  return iconToEmoji[normalized] ?? "•";
}

/**
 * Get all available icon names
 */
export function getAvailableIcons(): string[] {
  return Object.keys(iconToEmoji);
}
