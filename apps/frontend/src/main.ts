import { registerLocaleData } from '@angular/common';
import localeHu from '@angular/common/locales/hu';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Register Hungarian locale under both IDs so DatePipe accepts 'hu-HU' and 'hu'.
registerLocaleData(localeHu, 'hu-HU');
registerLocaleData(localeHu, 'hu');

bootstrapApplication(AppComponent, appConfig).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
});
