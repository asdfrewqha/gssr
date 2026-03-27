import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  useMapEvents,
} from "react-leaflet";

interface Props {
  floorImageUrl: string;
  onGuess: (x: number, y: number) => void;
  guess?: { x: number; y: number } | null;
  correctLocation?: { x: number; y: number } | null;
}

// Normalized [0,1]×[0,1] coordinate space
const BOUNDS: L.LatLngBoundsExpression = [
  [0, 0],
  [1, 1],
];

function ClickHandler({
  onGuess,
}: {
  onGuess: (x: number, y: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      // Leaflet lat increases upward; image y increases downward → invert
      const x = Math.max(0, Math.min(1, e.latlng.lng));
      const y = Math.max(0, Math.min(1, 1 - e.latlng.lat));
      onGuess(x, y);
    },
  });
  return null;
}

export function GuessMap({
  floorImageUrl,
  onGuess,
  guess,
  correctLocation,
}: Props) {
  return (
    <MapContainer
      crs={L.CRS.Simple}
      bounds={BOUNDS}
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
      zoomControl={false}
    >
      <ImageOverlay url={floorImageUrl} bounds={BOUNDS} />
      <ClickHandler onGuess={onGuess} />
      {guess && (
        <CircleMarker
          center={[1 - guess.y, guess.x]}
          radius={8}
          pathOptions={{
            color: "#6366f1",
            fillColor: "#6366f1",
            fillOpacity: 0.9,
            weight: 2,
          }}
        />
      )}
      {correctLocation && (
        <CircleMarker
          center={[1 - correctLocation.y, correctLocation.x]}
          radius={8}
          pathOptions={{
            color: "#22c55e",
            fillColor: "#22c55e",
            fillOpacity: 0.9,
            weight: 2,
          }}
        />
      )}
    </MapContainer>
  );
}
