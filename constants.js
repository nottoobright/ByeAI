// Shared constants for every ByeAI extension context.
// Classic scripts (contentScript, popup, options, stats) load this file first;
// background.js (an ES module) imports it for its side effect. All of them
// read globalThis.BYEAI.
globalThis.BYEAI = {
  API: 'https://api.byeai.club',
  CATS: [
    { id: 'ai-general',   label: 'AI-General',         desc: 'AI used throughout' },
    { id: 'ai-script',    label: 'AI-Script',          desc: 'AI-written content' },
    { id: 'ai-thumbnail', label: 'AI-Image/Thumbnail', desc: 'AI-generated images' },
    { id: 'ai-music',     label: 'AI-Music',           desc: 'AI-generated audio' },
    { id: 'ai-voice',     label: 'AI-Voice-over',      desc: 'Synthetic voice' },
    { id: 'deepfake',     label: 'Deepfake/Video',     desc: 'AI-manipulated video' },
    { id: 'other',        label: 'Other',              desc: 'Other AI usage' }
  ]
};
