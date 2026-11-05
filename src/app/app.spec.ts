import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet } from '@angular/router';
import { App } from './app';

// Cesium needs WebGL, which jsdom doesn't provide, so stub the viewer in unit tests.
@Component({ selector: 'app-jobsite-viewer', template: '' })
class JobsiteViewerStub {}

describe('App', () => {
  beforeEach(async () => {
    TestBed.overrideComponent(App, { set: { imports: [RouterOutlet, JobsiteViewerStub] } });
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the jobsite viewer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-jobsite-viewer')).toBeTruthy();
  });
});
