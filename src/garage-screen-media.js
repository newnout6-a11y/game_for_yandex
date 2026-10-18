/**
 * Complete user-supplied Tesla stunt footage, locally remuxed without audio.
 * All 1,052 video frames and the original 16:9 view are retained. This is not
 * original game artwork, a live stream, an ad integration or an endorsement.
 * Source attribution and reproduction checks live in the supplied-media report.
 */
export const GARAGE_SCREEN_MEDIA = Object.freeze({
  status: 'user-supplied-tesla-kickflip',
  video: new URL('../public/assets/garage/roadster-screen-loop.mp4', import.meta.url).href,
  poster: new URL('../public/assets/garage/roadster-screen-poster.jpg', import.meta.url).href,
});
