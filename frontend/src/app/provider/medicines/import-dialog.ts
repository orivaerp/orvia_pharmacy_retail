import { Component, inject, output, signal } from '@angular/core';
import { GST_RATES } from '../../shared/models/medicine';
import { ImportResult, ProviderApi, apiError } from '../provider-api.service';

const TEMPLATE =
  'name,brand,composition,strength,form,unitsPerPack,manufacturer,hsn,gstPercent,schedule,category,barcodes\n' +
  'Paracetamol 500mg Tablet,,Paracetamol,500mg,tablet,15,Your Pharma Ltd,3004,5,OTC,Analgesic,8901234567890\n';

const BRAND_TEMPLATE =
  'Brand Name,Manufacturer,Composition,Strength,Form,Pack,MRP,Barcode,HSN,GST,Schedule,Category\n' +
  "Dolo 650 Tablet,Micro Labs Ltd,Paracetamol,650mg,Tablet,15's,30.91,8901234567890,3004,5,OTC,Analgesic\n";

/** CSV import: always check the file first (dry run), then confirm the real import. */
@Component({
  selector: 'app-import-dialog',
  template: `
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="closed.emit()">
      <div class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <h2 class="text-lg font-medium">Import medicines from CSV</h2>
        <p class="mt-0.5 text-xs text-ink-soft">
          Up to 5000 rows. Salts separated by <b>;</b>. Existing medicines (same name, strength, form and manufacturer) are skipped.
          <button type="button" class="underline" (click)="downloadTemplate()">Download template</button> ·
          <button type="button" class="underline" (click)="downloadTemplate('brand')">Branded list template</button>
        </p>
        <p class="mt-1 text-xs text-ink-soft">
          Sample files to try (the check below shows what would happen first, nothing is saved):
          <a href="samples/medicine-master-sample.csv" download class="underline">45 medicines, every column</a> ·
          <a href="samples/medicine-master-brand-list-sample.csv" download class="underline">branded list</a> ·
          <a href="samples/medicine-master-generic-list-sample.csv" download class="underline">generic list</a> ·
          <a href="samples/medicine-master-sample-with-mistakes.csv" download class="underline">a file with mistakes to see the errors</a>
        </p>

        @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

        @if (!done()) {
          <input type="file" accept=".csv,text/csv" class="field mt-4" (change)="onFile($event)" />

          @if (brandList()) {
            <div class="mt-3 rounded-xl bg-tone-lavender p-3 text-xs">
              <p class="font-medium">Branded medicine list detected</p>
              <p class="mt-0.5">The brand is taken from <b>Brand Name</b>; form, strength and pack size are worked out where the file does not give them. <b>Every row is imported as pending</b>, so check schedule, GST and HSN before verifying. Fill-in values for missing columns:</p>
              <div class="mt-2 grid gap-2 sm:grid-cols-2">
                <div><label class="label" for="b-hsn">HSN</label><input id="b-hsn" class="field" [value]="hsn()" (input)="hsn.set($any($event.target).value)" /></div>
                <div>
                  <label class="label" for="b-gst">GST %</label>
                  <select id="b-gst" class="field" (change)="gst.set(+$any($event.target).value)">
                    @for (g of gstRates; track g) { <option [value]="g" [selected]="g === gst()">{{ g }}%</option> }
                  </select>
                </div>
              </div>
            </div>
          }

          @if (generic()) {
            <div class="mt-3 rounded-xl bg-tone-lavender p-3 text-xs">
              <p class="font-medium">Supplier product list detected</p>
              <p class="mt-0.5">
                Form, strength, salts and pack size are worked out from each name. This file has no manufacturer, HSN or GST, so these are filled in
                (change them if needed). <b>Every row is imported as pending</b>, so shops cannot see them until you verify schedule, GST and HSN.
              </p>
              <div class="mt-2 grid gap-2 sm:grid-cols-3">
                <div><label class="label" for="d-mfr">Manufacturer</label><input id="d-mfr" class="field" [value]="mfr()" (input)="mfr.set($any($event.target).value)" /></div>
                <div><label class="label" for="d-hsn">HSN</label><input id="d-hsn" class="field" [value]="hsn()" (input)="hsn.set($any($event.target).value)" /></div>
                <div>
                  <label class="label" for="d-gst">GST %</label>
                  <select id="d-gst" class="field" (change)="gst.set(+$any($event.target).value)">
                    @for (g of gstRates; track g) { <option [value]="g" [selected]="g === gst()">{{ g }}%</option> }
                  </select>
                </div>
              </div>
            </div>
          }

          @if (result(); as r) {
            <div class="mt-4 rounded-xl bg-white/70 p-3 text-xs">
              <p><b>{{ r.totalRows }}</b> rows read: <b class="text-green-700">{{ r.toCreate }} new</b>, {{ r.duplicates.length }} already there / repeated, <b [class.text-red-700]="r.errors.length">{{ r.errors.length }} with errors</b>.</p>
              @if (r.errors.length) {
                <p class="mt-2 font-medium">Rows with errors (skipped):</p>
                <ul class="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4 text-red-700">
                  @for (e of r.errors.slice(0, 50); track e.row) { <li>Row {{ e.row }}{{ e.name ? ' (' + e.name + ')' : '' }}: {{ e.message }}</li> }
                </ul>
              }
              @if (r.duplicates.length) {
                <p class="mt-2 font-medium">Skipped as duplicates:</p>
                <ul class="mt-1 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 text-ink-soft">
                  @for (d of r.duplicates.slice(0, 50); track d.row) { <li>Row {{ d.row }}{{ d.name ? ' (' + d.name + ')' : '' }}: {{ d.reason }}</li> }
                </ul>
              }
            </div>
          }

          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancel</button>
            <button type="button" class="btn btn-ghost" [disabled]="!csv() || busy()" (click)="run(true)">{{ busy() && !result() ? 'Checking…' : 'Check file' }}</button>
            <button type="button" class="btn btn-primary" [disabled]="!result() || result()!.toCreate === 0 || busy()" (click)="run(false)">
              Import {{ result()?.toCreate ?? 0 }} medicines
            </button>
          </div>
        } @else {
          <p class="mt-4 rounded-xl bg-tone-lime px-3 py-2 text-sm">Imported {{ result()?.created }} new medicines.</p>
          <div class="mt-4 flex justify-end"><button type="button" class="btn btn-primary" (click)="finished.emit()">Done</button></div>
        }
      </div>
    </div>
  `,
})
export class ImportDialog {
  private readonly api = inject(ProviderApi);

  closed = output();
  finished = output();

  protected readonly csv = signal('');
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly done = signal(false);

  // supplier-style lists lack manufacturer / HSN / GST: the provider chooses the defaults here
  protected readonly gstRates = GST_RATES;
  protected readonly generic = signal(false);
  protected readonly brandList = signal(false);
  protected readonly mfr = signal('Generic (unbranded)');
  protected readonly hsn = signal('3004');
  protected readonly gst = signal(5);

  protected async onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    this.result.set(null);
    this.error.set(null);
    if (!file) return this.csv.set('');
    if (file.size > 1_800_000) {
      this.csv.set('');
      return this.error.set('File is too large. Split it into files of up to 5000 rows.');
    }
    const text = await file.text();
    this.csv.set(text);
    const header = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
    this.generic.set(header.includes('Generic Name') && header.includes('Unit Size'));
    this.brandList.set(header.includes('Brand Name') && header.includes('Manufacturer'));
  }

  protected run(dryRun: boolean) {
    this.busy.set(true);
    this.error.set(null);
    const defaults = this.generic()
      ? { manufacturer: this.mfr().trim(), hsn: this.hsn().trim(), gstPercent: this.gst() }
      : this.brandList()
        ? { hsn: this.hsn().trim(), gstPercent: this.gst() }
        : undefined;
    this.api.importMedicines(this.csv(), dryRun, defaults).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.result.set(r);
        if (!dryRun) this.done.set(true);
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected downloadTemplate(kind: 'standard' | 'brand' = 'standard') {
    const url = URL.createObjectURL(new Blob([kind === 'brand' ? BRAND_TEMPLATE : TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'brand' ? 'branded-medicines-template.csv' : 'medicines-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
