interface Floor {
  id: string;
  floor_number: number;
  label: string;
}

interface Props {
  floors: Floor[];
  selected: string;
  onChange: (floorId: string) => void;
}

export function FloorSelector({ floors, selected, onChange }: Props) {
  if (floors.length <= 1) return null;
  return (
    <div className="flex gap-1 flex-wrap">
      {floors.map((f) => (
        <button
          key={f.id}
          onClick={() => onChange(f.id)}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            selected === f.id
              ? "bg-indigo-600 text-white"
              : "bg-gray-700/80 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {f.label || `F${f.floor_number}`}
        </button>
      ))}
    </div>
  );
}
