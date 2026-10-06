import type { Translation } from "./strings";

// Neutral Spanish, for Spain and Latin America alike.
export default {
  widget_description: "Inicia y detén el ruido blanco o rosa.",
  noise_white_title: "Ruido blanco",
  noise_pink_title: "Ruido rosa",
  noise_white_short: "Blanco",
  noise_pink_short: "Rosa",
  noise_white_blurb: "La misma energía en todas las frecuencias. Brillante y nítido.",
  noise_pink_blurb: "Agudos más suaves, graves más profundos. Como una lluvia constante.",
  status_playing: "Reproduciendo · {noise}",
  status_tap_to_start: "Toca un sonido para empezar",
  status_click_to_start: "Haz clic en un sonido para empezar",
  status_audio_failed: "Este navegador no pudo iniciar el audio.",
  play_noise: "Reproducir {noise}",
  stop_noise: "Detener {noise}",
  stop: "Detener",
  volume: "Volumen",
  notification_channel_name: "Reproducción",
  intent_noise: "Ruido",
  intent_play_title: "Reproducir ruido",
  intent_play_description: "Empieza a reproducir ruido blanco o rosa.",
  intent_stop_title: "Detener ruido",
  intent_stop_description: "Detiene la reproducción.",
  support: "Soporte",
  privacy_policy: "Política de privacidad",
} satisfies Translation;
