"use client";

import { useEffect, useRef } from "react";
import type { Weather } from "@/lib/garden-store";

/**
 * Per-weather timbre for the shared noise bed. Values retune the running
 * audio graph smoothly; nothing here justifies rebuilding the context or its
 * multi-megabyte noise buffer.
 */
const WEATHER_SOUND_PROFILE: Record<
  Weather,
  { cutoff: number; level: number }
> = {
  sunny: { cutoff: 760, level: 0.12 },
  rain: { cutoff: 1800, level: 0.38 },
  fog: { cutoff: 620, level: 0.09 },
  snow: { cutoff: 500, level: 0.06 },
  wind: { cutoff: 1150, level: 0.27 },
};

interface AmbientGraph {
  context: AudioContext;
  filter: BiquadFilterNode;
  noiseGain: GainNode;
  chirp: () => void;
}

export function useAmbientSound(
  enabled: boolean,
  weather: Weather,
  reducedMotion = false,
) {
  const graphRef = useRef<AmbientGraph | null>(null);
  const chirpTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  // Create/teardown keyed on `enabled` only, so toggling weather retunes the
  // existing graph below instead of discarding and rebuilding everything.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    // Re-entering quickly (Strict Mode, fast toggles): cancel any pending
    // close from the previous teardown so one context stays alive.
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    const AudioContextClass = window.AudioContext;
    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.setValueAtTime(0, context.currentTime);
    master.gain.linearRampToValueAtTime(0.07, context.currentTime + 1.2);
    master.connect(context.destination);

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.45;
    filter.connect(master);

    // One ~3-second noise bed generated once; loudness lives in noiseGain so
    // weather changes never regenerate this buffer.
    const bufferSize = context.sampleRate * 3;
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      const drift = Math.sin(index / 7200) * 0.1;
      channel[index] = (Math.random() * 2 - 1) * 0.4 + drift;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const noiseGain = context.createGain();
    noise.connect(noiseGain).connect(filter);
    noise.start();

    const hum = context.createOscillator();
    const humGain = context.createGain();
    hum.type = "sine";
    hum.frequency.value = 92;
    humGain.gain.value = 0.055;
    hum.connect(humGain).connect(master);
    hum.start();

    graphRef.current = {
      context,
      filter,
      noiseGain,
      chirp: () => {
        if (context.state !== "running") return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(1050 + Math.random() * 650, now);
        oscillator.frequency.exponentialRampToValueAtTime(
          1800 + Math.random() * 800,
          now + 0.12,
        );
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.035, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        oscillator.connect(gain).connect(master);
        oscillator.start(now);
        oscillator.stop(now + 0.24);
      },
    };

    void context.resume();

    return () => {
      graphRef.current = null;
      if (chirpTimerRef.current !== null) {
        window.clearInterval(chirpTimerRef.current);
        chirpTimerRef.current = null;
      }
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(0, context.currentTime, 0.08);
      // Fade out before closing; keep the timer tracked so a quick re-enable
      // can cancel it instead of closing the fresh replacement graph.
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        void context.close();
      }, 350);
    };
  }, [enabled]);

  // Weather changes glide the existing filter/gain to the new profile.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const profile = WEATHER_SOUND_PROFILE[weather];
    const now = graph.context.currentTime;
    graph.filter.frequency.cancelScheduledValues(now);
    graph.filter.frequency.setTargetAtTime(profile.cutoff, now, 0.45);
    graph.noiseGain.gain.cancelScheduledValues(now);
    graph.noiseGain.gain.setTargetAtTime(profile.level, now, 0.45);
  }, [enabled, weather]);

  // Birdsong cadence; silenced under reduced motion like the visual motion.
  useEffect(() => {
    if (enabled && !reducedMotion && graphRef.current) {
      if (chirpTimerRef.current === null) {
        chirpTimerRef.current = window.setInterval(
          () => graphRef.current?.chirp(),
          3800 + Math.random() * 2600,
        );
      }
      return;
    }
    if (chirpTimerRef.current !== null) {
      window.clearInterval(chirpTimerRef.current);
      chirpTimerRef.current = null;
    }
  }, [enabled, reducedMotion]);
}
