import { Component, effect, input, output, signal, untracked } from '@angular/core';

import type { MachineType } from '../graphql/generated/graphql';
import {
  MACHINE_TYPE_LABELS,
  MACHINE_TYPES,
  parseSpeed,
  validateMachineFields,
  type MachineFields,
} from '../scenarios/route-draft';
import type { MachineData } from '../scenarios/scenario.service';

export interface MachineEdit {
  id: string;
  fields: MachineFields;
}

/**
 * Lists a scenario's machines with Follow / Edit / Delete, plus Add machine. It only
 * emits intents; the parent runs the API calls, then reloads the scenario. A new
 * `machines` list closes any open editor or delete confirmation.
 */
@Component({
  selector: 'app-machine-panel',
  template: `
    <section class="machine-panel" aria-label="Machines">
      <header>
        <h2>Machines</h2>
        <button type="button" (click)="add.emit()" [disabled]="busy()">Add machine</button>
      </header>

      @if (machines().length === 0) {
        <p class="hint">No machines yet. Add one by drawing its route.</p>
      }

      <ul>
        @for (m of machines(); track m.id) {
          <li>
            @if (editingId() === m.id) {
              <form (submit)="saveEdit($event, m.id)" (input)="errors.set([])" novalidate>
                <label>
                  Name
                  <input
                    [value]="editName()"
                    (input)="editName.set(inputValue($event))"
                    maxlength="100"
                  />
                </label>
                <label>
                  Type
                  <select (change)="editType.set($any(inputValue($event)))">
                    @for (t of machineTypes; track t) {
                      <option [value]="t" [selected]="t === editType()">
                        {{ machineTypeLabels[t] }}
                      </option>
                    }
                  </select>
                </label>
                <label>
                  Speed (m/s)
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    [value]="editSpeed()"
                    (input)="editSpeed.set(inputValue($event))"
                  />
                </label>
                @if (errors().length > 0) {
                  <ul class="form-errors" role="alert">
                    @for (e of errors(); track $index) {
                      <li>{{ e }}</li>
                    }
                  </ul>
                }
                <div class="actions">
                  <button type="button" (click)="closeEditor()" [disabled]="busy()">Cancel</button>
                  <button type="submit" class="primary" [disabled]="busy()">
                    {{ busy() ? 'Saving…' : 'Save' }}
                  </button>
                </div>
              </form>
            } @else if (confirmingId() === m.id) {
              <p class="confirm">Delete “{{ m.name }}” and its route?</p>
              <div class="actions">
                <button type="button" (click)="closeEditor()" [disabled]="busy()">Cancel</button>
                <button type="button" class="danger" (click)="remove.emit(m.id)" [disabled]="busy()">
                  {{ busy() ? 'Deleting…' : 'Delete' }}
                </button>
              </div>
            } @else {
              <div class="summary">
                <span class="name">{{ m.name }}</span>
                <span class="meta">{{ machineTypeLabels[m.type] }} · {{ m.speedMps }} m/s</span>
              </div>
              <div class="actions">
                <button type="button" (click)="follow.emit(m.id)">Follow</button>
                <button type="button" (click)="openEditor(m)" [disabled]="busy()">Edit</button>
                <button type="button" (click)="confirmingId.set(m.id)" [disabled]="busy()">
                  Delete
                </button>
              </div>
            }
          </li>
        }
      </ul>

      @if (error()) {
        <p class="form-errors" role="alert">{{ error() }}</p>
      }
    </section>
  `,
  styleUrl: './machine-panel.scss',
  host: { '(keydown.escape)': 'closeEditor()' },
})
export class MachinePanelComponent {
  readonly machines = input.required<readonly MachineData[]>();
  /** True while the parent is saving; disables changes. */
  readonly busy = input(false);
  /** Last API error from the parent, if any. */
  readonly error = input<string | null>(null);

  readonly follow = output<string>();
  readonly add = output<void>();
  readonly save = output<MachineEdit>();
  readonly remove = output<string>();

  protected readonly machineTypes = MACHINE_TYPES;
  protected readonly machineTypeLabels = MACHINE_TYPE_LABELS;

  protected readonly editingId = signal<string | null>(null);
  protected readonly confirmingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editType = signal<MachineType>('HAUL_TRUCK');
  /** Kept as typed text; parsed and validated on save. */
  protected readonly editSpeed = signal('');
  protected readonly errors = signal<string[]>([]);

  constructor() {
    // A reloaded scenario means the last change was saved (or the scenario changed).
    effect(() => {
      this.machines();
      untracked(() => this.closeEditor());
    });
  }

  protected openEditor(m: MachineData): void {
    this.confirmingId.set(null);
    this.editingId.set(m.id);
    this.editName.set(m.name);
    this.editType.set(m.type);
    this.editSpeed.set(String(m.speedMps));
    this.errors.set([]);
  }

  protected closeEditor(): void {
    if (this.busy()) return;
    this.editingId.set(null);
    this.confirmingId.set(null);
    this.errors.set([]);
  }

  protected saveEdit(event: Event, id: string): void {
    event.preventDefault();
    if (this.busy()) return;
    const fields: MachineFields = {
      machineName: this.editName(),
      machineType: this.editType(),
      speedMps: parseSpeed(this.editSpeed()),
    };
    const errors = validateMachineFields(fields);
    this.errors.set(errors);
    if (errors.length === 0) {
      this.save.emit({ id, fields });
    }
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
