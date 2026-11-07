import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { MapPin, X } from 'lucide-react';
import { MAX_MERCATOR_LATITUDE, parseCoordinateInputs, type GeographicCoordinate } from '../domain/coordinateNavigation';
import './coordinateNavigation.css';

interface Props {
  onNavigate(coordinate: GeographicCoordinate): void;
  onClear(): void;
}

export function CoordinateNavigation({ onNavigate, onClear }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const latitudeInput = useRef<HTMLInputElement>(null);
  const longitudeInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [error, setError] = useState<{ field: keyof GeographicCoordinate; error: string }>();
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (open) latitudeInput.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function clearFeedback() {
    setError(undefined);
    setStatus('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = parseCoordinateInputs(latitude, longitude);
    if (!result.ok) {
      setError(result);
      setStatus('');
      (result.field === 'latitude' ? latitudeInput : longitudeInput).current?.focus();
      return;
    }
    onNavigate(result.coordinate);
    setError(undefined);
    setStatus(Math.abs(result.coordinate.latitude) > MAX_MERCATOR_LATITUDE
      ? 'İşaret, haritanın gösterebildiği en yakın enleme yerleştirildi.'
      : 'Konum işaretlendi.');
  }

  return (
    <div className="coordinate-navigation" onKeyDown={event => {
      // Enter and Escape also control map drawing when focus is outside this panel.
      event.stopPropagation();
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        close();
      }
    }}>
      <button ref={trigger} type="button" className="button secondary coordinate-trigger"
        aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => open ? close() : setOpen(true)}>
        <MapPin size={15} aria-hidden="true" /> Koordinata Git
      </button>
      {open && (
        <form id={id} className="coordinate-panel" aria-label="Koordinata Git" onSubmit={submit}>
          <div className="coordinate-panel-heading">
            <strong>Koordinata Git</strong>
            <button type="button" className="icon-button" aria-label="Koordinat panelini kapat" onClick={close}><X size={17} /></button>
          </div>
          <label>
            Enlem
            <input ref={latitudeInput} type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
              value={latitude} placeholder="41,0082" aria-invalid={error?.field === 'latitude'}
              aria-describedby={error?.field === 'latitude' ? `${id}-error` : undefined}
              onChange={event => { setLatitude(event.target.value); clearFeedback(); }} />
          </label>
          <label>
            Boylam
            <input ref={longitudeInput} type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
              value={longitude} placeholder="28,9784" aria-invalid={error?.field === 'longitude'}
              aria-describedby={error?.field === 'longitude' ? `${id}-error` : undefined}
              onChange={event => { setLongitude(event.target.value); clearFeedback(); }} />
          </label>
          {error && <p id={`${id}-error`} className="coordinate-error" role="alert">{error.error}</p>}
          {status && <p role="status">{status}</p>}
          <div className="coordinate-actions">
            <button className="button primary" type="submit">Git</button>
            <button className="button secondary" type="button" onClick={() => {
              setLatitude('');
              setLongitude('');
              clearFeedback();
              onClear();
              latitudeInput.current?.focus();
            }}>Temizle</button>
          </div>
        </form>
      )}
    </div>
  );
}
