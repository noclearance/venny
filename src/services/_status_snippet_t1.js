async function status(client) {
  return {
    ok: Boolean(client?.isReady?.()),
    discord: Boolean(client?.isReady?.()),
    xai: Boolean((process.env.XAI_API_KEY || '').trim()),
    openai: false,
    postgres: Boolean((process.env.DATABASE_URL || '').trim()),
    // Outbound hub ingest (aisBot): gated on BOT_SECRET; AIS_BOT_URL optional (has default).
    hub: {
      configured: Boolean((process.env.BOT_SECRET || '').trim()),
      url_set: Boolean((process.env.AIS_BOT_URL || '').trim()),
    },
    uptime_s: Math.round(process.uptime()),
  };
}
