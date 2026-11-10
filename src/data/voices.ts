/**
 * What people have said about the project in public — the cards of the
 * "voices" band under the hero (src/sections/Voices.astro).
 *
 * THE RULES OF THIS FILE, because a quote on a marketing page is a claim about
 * a real person:
 *
 * - **Verbatim.** Every `text` is copied from its source as written, typos
 *   included. A cut is marked with `…`; nothing is reworded, merged or
 *   translated.
 * - **Public and linked.** Every entry has the URL where it was said, and the
 *   card links there. Nothing from a private channel, a direct message or a
 *   server that needs an invite.
 * - **Third parties only.** Never the maintainer, never a bot, never a
 *   generated article.
 * - **Their own picture.** An `avatar` is the image on the author's public
 *   profile, unchanged apart from being scaled down.
 * - **Removable.** Anyone quoted here can ask to be taken out; open an issue
 *   and the entry goes.
 *
 * The project was called Personal Jarvis until October 2026, so some of these
 * were written about it under that name.
 */

export type VoiceSource = "GitHub" | "Reddit" | "X";

export interface Voice {
  /** The name or handle the person posts under. */
  author: string;
  source: VoiceSource;
  text: string;
  url: string;
  /**
   * The person's own profile picture, saved under public/media/voices/ as a
   * 96 px WebP. Copied from the profile once, not hotlinked, so the page
   * makes no request to the source site. Without one the card shows the
   * first letter of the name.
   */
  avatar?: string;
}

export const voices: readonly Voice[] = [
  {
    author: "Dan Kornas",
    source: "X",
    text: "Running multiple coding agents shouldn't mean juggling multiple windows.",
    url: "https://x.com/DanKornas/status/2111015273943715911",
    avatar: "/media/voices/dankornas.webp",
  },
  {
    author: "Idee-Wird-App",
    source: "GitHub",
    text: "I think it is remarkable how much functionality and potential this project already offers, especially considering that it is made available to users free of charge.",
    url: "https://github.com/Dodaios/Dodaios/pull/844",
    avatar: "/media/voices/idee-wird-app.webp",
  },
  {
    author: "u/Helpful_Jelly5486",
    source: "Reddit",
    text: "There is lots to like about this project. … What I noticed first is the use of local tts and stt models - whisper and piper.",
    url: "https://www.reddit.com/r/LocalLLaMA/comments/1wobcm2/opensource_alternative_to_grokbot_called/pbnywob/",
  },
  {
    author: "martiroca06",
    source: "GitHub",
    text: "… congrats on the great implementation. Keep up the good work!",
    url: "https://github.com/Dodaios/Dodaios/pull/509#issuecomment-6171844411",
    avatar: "/media/voices/martiroca06.webp",
  },
  {
    author: "u/Spare_Penalty_9209",
    source: "Reddit",
    text: "cool, im also building something like that but yours has so many capabilities working!",
    url: "https://www.reddit.com/r/LocalLLaMA/comments/1vj3b7m/i_built_a_local_realtime_voice_stack_for_ollama/p2iytt8/",
  },
  {
    author: "u/Affectionate-Top7058",
    source: "Reddit",
    text: "The idea of running multiple coding agents side by side and being able to coordinate them through voice is compelling.",
    url: "https://www.reddit.com/r/LocalLLaMA/comments/1xryile/local_first_open_source_alternative_to_grokbot/19sdyxmdu0l7m/",
  },
  {
    author: "pedrobettiol2025-collab",
    source: "GitHub",
    text: "… o app e muito bom obrigado",
    url: "https://github.com/Dodaios/Dodaios/discussions/461",
    avatar: "/media/voices/pedrobettiol2025-collab.webp",
  },
  {
    author: "u/Blues520",
    source: "Reddit",
    text: "I can see you put it in a lot of work so well done for delivering it.",
    url: "https://www.reddit.com/r/LocalLLaMA/comments/1vj3b7m/i_built_a_local_realtime_voice_stack_for_ollama/p2ic67o/",
  },
  {
    author: "IanOliverU",
    source: "GitHub",
    text: "Thank you to the Dodaios maintainers and contributors for building and sharing the foundation that makes this project possible.",
    url: "https://github.com/IanOliverU/PRTS#readme",
    avatar: "/media/voices/ianoliveru.webp",
  },
];
