import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { JobsiteViewerComponent } from './jobsite-viewer/jobsite-viewer';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, JobsiteViewerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
