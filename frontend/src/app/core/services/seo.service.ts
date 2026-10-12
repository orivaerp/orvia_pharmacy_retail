import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../../environments/environment';

/** What each public page says about itself. Only these pages are offered to search engines; everything else is kept out. */
const PAGES: Record<string, { description: string }> = {
  '/login': { description: 'Sign in to your Orvia pharmacy workspace: billing, stock, batches and expiry for your medical store.' },
  '/signup': { description: 'Start a free trial of Orvia pharmacy software. Choose a plan, set up your shop in minutes and start billing with GST, batch and expiry tracking.' },
  '/pricing': { description: 'Orvia pharmacy software pricing: plans for one medical store or many outlets, with a free trial. Prices are before GST.' },
};

/**
 * Keeps the page title, description, share card (Open Graph, X), canonical address and robots tag right for each address.
 * The first, general version of these tags is in index.html (social sites read only that). Here they follow the page after the app loads, which is what
 * Google reads. The signed-in app, invitation and password pages, and a customer's bill link are never indexed.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly router = inject(Router);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly doc = inject(DOCUMENT);

  start() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => this.apply(e.urlAfterRedirects.split(/[?#]/)[0] || '/'));
  }

  private apply(path: string) {
    const page = PAGES[path];
    const url = `${environment.siteUrl}${path === '/' ? '/' : path}`;
    // the title comes from the route (set by the router a moment ago); the share card repeats it
    const title = this.title.getTitle();
    this.meta.updateTag({ name: 'robots', content: page ? 'index, follow, max-image-preview:large' : 'noindex, nofollow' });
    if (page) {
      this.meta.updateTag({ name: 'description', content: page.description });
      this.meta.updateTag({ property: 'og:title', content: title });
      this.meta.updateTag({ property: 'og:description', content: page.description });
      this.meta.updateTag({ property: 'og:url', content: url });
      this.meta.updateTag({ name: 'twitter:title', content: title });
      this.meta.updateTag({ name: 'twitter:description', content: page.description });
      this.canonical(url);
    }
  }

  private canonical(url: string) {
    let link = this.doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.rel = 'canonical';
      this.doc.head.appendChild(link);
    }
    link.href = url;
  }
}
