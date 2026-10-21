import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly darkSignal = signal<boolean>(this.getInitial());
  readonly isDark = this.darkSignal.asReadonly();

  constructor() {
    this.applyTheme(this.darkSignal());
  }

  toggle(): void {
    const next = !this.darkSignal();
    this.darkSignal.set(next);
    this.applyTheme(next);
    localStorage.setItem('kaesuri-theme', next ? 'dark' : 'light');
  }

  private getInitial(): boolean {
    const saved = localStorage.getItem('kaesuri-theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private applyTheme(dark: boolean): void {
    document.body.classList.toggle('dark', dark);
  }
}