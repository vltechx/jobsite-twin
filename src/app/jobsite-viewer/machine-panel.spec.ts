import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { MachineData } from '../scenarios/scenario.service';
import { MachinePanelComponent, type MachineEdit } from './machine-panel';

const machines: MachineData[] = [
  { id: 'm1', name: 'Truck 1', type: 'HAUL_TRUCK', speedMps: 8, route: [] },
  { id: 'm2', name: 'Dozer 1', type: 'DOZER', speedMps: 3, route: [] },
];

describe('MachinePanelComponent', () => {
  let fixture: ComponentFixture<MachinePanelComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(MachinePanelComponent);
    fixture.componentRef.setInput('machines', machines);
    await fixture.whenStable();
    el = fixture.nativeElement;
  });

  const buttons = (text: string) =>
    [...el.querySelectorAll('button')].filter((b) => b.textContent?.trim() === text);

  async function type(input: HTMLInputElement, value: string): Promise<void> {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('lists machines with type and speed', () => {
    const text = (sel: string) => [...el.querySelectorAll(sel)].map((e) => e.textContent?.trim());
    expect(text('.name')).toEqual(['Truck 1', 'Dozer 1']);
    expect(text('.meta')).toEqual(['Haul truck · 8 m/s', 'Dozer · 3 m/s']);
  });

  it('emits follow and add', () => {
    const followed: string[] = [];
    let added = 0;
    fixture.componentInstance.follow.subscribe((id) => followed.push(id));
    fixture.componentInstance.add.subscribe(() => added++);
    buttons('Follow')[1].click();
    buttons('Add machine')[0].click();
    expect(followed).toEqual(['m2']);
    expect(added).toBe(1);
  });

  it('edits a machine and emits the parsed fields', async () => {
    const saved: MachineEdit[] = [];
    fixture.componentInstance.save.subscribe((e) => saved.push(e));
    buttons('Edit')[1].click();
    await fixture.whenStable();

    const [name, speed] = [...el.querySelectorAll('input')];
    expect(name.value).toBe('Dozer 1');
    await type(name, 'Dozer A');
    await type(speed, '4.5');
    const select = el.querySelector('form select') as HTMLSelectElement;
    select.value = 'EXCAVATOR';
    select.dispatchEvent(new Event('change'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));

    expect(saved).toEqual([
      { id: 'm2', fields: { machineName: 'Dozer A', machineType: 'EXCAVATOR', speedMps: 4.5 } },
    ]);
  });

  it('shows validation errors instead of emitting', async () => {
    const saved: MachineEdit[] = [];
    fixture.componentInstance.save.subscribe((e) => saved.push(e));
    buttons('Edit')[0].click();
    await fixture.whenStable();
    const [name, speed] = [...el.querySelectorAll('input')];
    await type(name, ' ');
    await type(speed, '');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(saved).toEqual([]);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Machine name is required.');
  });

  it('asks before deleting, then emits remove', async () => {
    const removed: string[] = [];
    fixture.componentInstance.remove.subscribe((id) => removed.push(id));
    buttons('Delete')[0].click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Delete “Truck 1” and its route?');
    expect(removed).toEqual([]);
    buttons('Delete')[0].click();
    expect(removed).toEqual(['m1']);
  });

  it('closes the editor when a new machine list arrives', async () => {
    buttons('Edit')[0].click();
    await fixture.whenStable();
    expect(el.querySelector('form')).not.toBeNull();
    fixture.componentRef.setInput('machines', [...machines]);
    await fixture.whenStable();
    expect(el.querySelector('form')).toBeNull();
  });
});
