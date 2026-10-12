import { Orbit } from 'lucide-react';

export default function Logo({ compact = false }) {
  return (
    <div className="brand">
      <div className="logo"><Orbit size={22} /></div>
      {!compact && 'devorbit'}
    </div>
  );
}

export function LogoMark() {
  return <div className="logo"><Orbit size={22} /></div>;
}
