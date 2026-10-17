import { CharacterDef } from './sim/types';

const CPS = 40;              // typewriter speed, characters per second
const HOLD = 1.3;            // a finished line stays up this long…
const HOLD_PER_CHAR = 0.03;  // …plus reading time

/**
 * The pre-round bickering as PS1-RPG text windows: one speaker at a time,
 * a name tab, a headshot, typewriter text and a blinking ▼. Line i is
 * spoken by `chars[i]` — P1 from the left, P2 answering from the right.
 * The headshot is the character's `portrait` image (a path relative to the
 * page); until that file exists it's a placeholder in their shirt colour.
 * Plain DOM, ticked from the render loop; it never touches the sim.
 */
export class Dialogue {
  private faces: HTMLElement[];
  private name: HTMLElement;
  private said: HTMLElement;
  private unsaid: HTMLElement;
  private next: HTMLElement;
  private lines: string[] = [];
  private line = -1;
  private t = 0;
  private shown = -1;

  constructor(private root: HTMLElement, private chars: CharacterDef[]) {
    const el = (cls: string, parent: HTMLElement, tag = 'div'): HTMLElement => {
      const e = document.createElement(tag);
      e.className = cls;
      parent.appendChild(e);
      return e;
    };
    const frame = el('dlg-portrait', root);
    this.faces = chars.map((c) => {
      const face = el('dlg-face', frame);
      face.style.setProperty('--shirt', c.colors.body);
      el('dlg-ph', face).textContent = c.name[0].toUpperCase();
      if (c.portrait) {
        const img = new Image();
        img.alt = c.name;
        img.onload = () => face.replaceChildren(img); // placeholder until the file exists
        img.src = c.portrait;
      }
      return face;
    });
    const box = el('dlg-window', root);
    this.name = el('dlg-name', box);
    const text = el('dlg-text', box);
    this.said = el('', text, 'span');
    this.unsaid = el('dlg-unsaid', text, 'span'); // keeps the line's final wrapping while it types
    this.next = el('dlg-next', box);
    this.next.textContent = '▼';
  }

  /** Start a new exchange: `lines[i]` is spoken by `chars[i]`. */
  say(lines: readonly string[]): void {
    this.lines = [...lines];
    this.begin(0);
  }

  update(dt: number): void {
    if (this.line < 0) return;
    this.t += dt;
    const text = this.lines[this.line];
    const n = Math.min(text.length, Math.floor(this.t * CPS));
    if (n !== this.shown) {
      this.shown = n;
      this.said.textContent = text.slice(0, n);
      this.unsaid.textContent = text.slice(n);
      this.next.hidden = n < text.length;
    }
    if (this.t < text.length / CPS + HOLD + text.length * HOLD_PER_CHAR) return;
    if (this.line + 1 < this.lines.length) this.begin(this.line + 1);
    else {
      this.line = -1;
      this.root.classList.remove('on');
    }
  }

  private begin(i: number): void {
    this.line = i;
    this.t = 0;
    this.shown = -1;
    const who = i % this.chars.length;
    this.name.textContent = this.chars[who].name.toUpperCase();
    this.faces.forEach((f, k) => (f.hidden = k !== who));
    this.root.classList.toggle('right', who % 2 === 1);
    this.root.classList.add('on');
    this.update(0);
  }
}
