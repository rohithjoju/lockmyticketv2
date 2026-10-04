'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

type Props = {
  latitude: number | null;
  longitude: number | null;
  city: string;
};

/**
 * Epic 6 — Mapbox event map component.
 *
 * Renders a static-looking Mapbox GL map. Disabled interactivity by default
 * so it doesn't trap scrolling on mobile, but users can click a button to open
 * directions in Google Maps / Apple Maps.
 * Fails gracefully if Mapbox token is missing.
 */
export function TicketMap({ latitude, longitude, city }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    if (!token || !latitude || !longitude || !mapContainer.current) return;

    mapboxgl.accessToken = token;

    if (!mapInstance.current) {
      mapInstance.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11', // Matches the app's dark aesthetic
        center: [longitude, latitude],
        zoom: 14,
        interactive: false, // Prevents scroll hijacking
      });

      new mapboxgl.Marker({ color: '#6366f1' }) // accent color
        .setLngLat([longitude, latitude])
        .addTo(mapInstance.current);
    }
  }, [latitude, longitude, token]);

  if (!token) {
    return null; // Graceful degradation in dev environments without a mapbox token
  }

  if (!latitude || !longitude) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl bg-sunk">
        <p className="text-sm text-muted">Location coordinates not provided.</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-sunk">
      <div ref={mapContainer} className="h-48 w-full" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white hover:text-accent"
        >
          Get directions ↗
        </a>
      </div>
    </div>
  );
}
