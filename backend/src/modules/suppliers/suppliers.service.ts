import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Supplier } from './entities';

export interface CreateSupplierDto {
  name: string;
  phone?: string;
  rep?: string;
  email?: string;
  notes?: string;
  warrantyContact?: string;
}

export type UpdateSupplierDto = Partial<CreateSupplierDto>;

// Initial supplier directory — sourced from the AUS Lighting Point of
// Contact form. Auto-seeded on first boot so the page is useful out of
// the gate; staff can edit/add/delete from the UI afterwards.
const SEED_SUPPLIERS: CreateSupplierDto[] = [
  { name: '3A LIGHTING', phone: '02 9724 7263' },
  { name: 'ADM\\MEANWELL', phone: '1300 236 467', rep: 'SOKATER: 0409 010 485' },
  { name: 'AMES (Prestige)', phone: '1300 310 451', rep: 'Nathan 0430 393 642' },
  { name: 'Alacio', phone: '0403 045 818', rep: 'Adam 0403 045 818' },
  { name: 'AQUALUX\\TELECTRAN', phone: '02 9454 7900', rep: 'Steve: 0410 641 120' },
  { name: 'BRIGHT GREEN', phone: '1300 672 499', email: 'sales@brightgreen.com.au' },
  { name: 'BRILLIANT LIGHTING', phone: '03 9765 2555', rep: 'Rob: 0412 037 701' },
  { name: 'Calibo Fans', phone: '1300 116 305', rep: 'Damien 0491 204 135' },
  { name: 'CDB Goldair (360 Fans)', phone: '03 9365 5100' },
  { name: 'CLA', phone: '02 9938 7100', rep: 'Glenn 0421 826 859' },
  { name: 'COUGAR Lighting', phone: '08 8169 2900', rep: 'Mark' },
  { name: 'CONTESSA', phone: '1300 887 948' },
  { name: 'DOMUS Lighting', phone: '02 9554 9600', rep: 'Spiro: 0468 964 433' },
  { name: 'EGLO Lighting', phone: '07 3375 1413', rep: 'Kate: 0403 095 820' },
  { name: 'EVERTOP Lighting', phone: '0474 888 333', rep: 'Colin' },
  { name: 'EMAC & LAWTON', phone: '03 8524 6159', rep: 'Elissa: 0422 532 249' },
  { name: 'FIORENTINO', phone: '08 8266 3222' },
  { name: 'FORM Lighting', phone: '02 8399 3418' },
  { name: 'GENTECH', phone: '03 9561 5688' },
  { name: 'GMT', phone: '03 9819 1777' },
  { name: 'HAVIT Lighting', phone: '02 9381 8300', rep: 'Steve: 0487 888 667' },
  { name: 'HUNTER PACIFIC', phone: '1300 369 828', rep: 'Rhonda: 0457 478 536' },
  { name: 'HUNZA Lighting', phone: '08 9240 2227', rep: 'Ben: 0420 855 514' },
  { name: 'ICON FANS', phone: '08 9456 4697', rep: 'Natalie' },
  { name: 'IXL', phone: '1300 727 421', rep: 'Ian 0433 567 433' },
  { name: 'LIGHTCO', phone: '1300 795 548', rep: 'Rob: 0424 230 428' },
  { name: 'Lighting Inspirations', phone: '03 9486 4115', rep: 'Catherine' },
  { name: 'MAYFIELD LAMPS', phone: '03 4226 5496' },
  { name: 'MECATOR', phone: '1300 552 255', rep: 'Katy: 0491 647 084 or Phil: 0422 521 233' },
  { name: 'OMNI Globes', phone: '1300 333 001' },
  { name: 'ORIEL Lighting', phone: '07 3715 9800' },
  { name: 'PHONIX Lighting (PHL)', phone: '02 9737 9030', rep: 'Mark: 0425 239 187' },
  { name: 'SUNNY Lighting (SAL)', phone: '03 9532 3168', rep: 'Chris: 0404 018 899' },
  { name: 'SUPERLUX', phone: '02 8216 4676' },
  { name: 'TOONGABBIE', phone: '02 9769 0812' },
  { name: 'TELBIX', phone: '9309 9060', rep: 'Anthony: 0498 100 222' },
  { name: 'TECLEC', phone: '03 9553 3600', rep: 'Alan' },
  { name: 'TEC LED', phone: '02 9317 4177', rep: 'Jeff 0430 873 544' },
  { name: 'TREND Lighting', phone: '02 9669 8888', rep: 'Jim' },
  { name: 'UGE', phone: '03 9416 7992' },
  { name: 'VIORE DESIGN', phone: '02 8060 1852' },
  { name: 'VENTAIR', phone: '03 9775 0556', rep: 'Richard: 0410 507 916' },
  { name: 'VENCHA', phone: '02 8811 1622', rep: 'Charlie: 0418 837 065' },
];

// Warranty claim destinations per supplier — verbatim from Sally's
// warranty spreadsheet (Book1.xlsx, Aug 2026). The sheet's contact
// column was misaligned for GMT / HAVIT / HUNTER PACIFIC / HUNZA
// (each value belonged one row down) — corrected here per Avi.
// Backfilled on boot into any supplier whose warrantyContact is NULL,
// so staff edits are never overwritten. Matching is fuzzy on name
// (case/whitespace/punctuation-insensitive); unmatched entries are
// created so the data is never silently dropped.
const WARRANTY_CONTACTS: Record<string, string> = {
  'ADM\\MEANWELL': 'Place in returns',
  'Alacio': 'See rep Adam',
  'AQUALUX\\TELECTRAN':
    'See Rep Steve or sales@havit.com.au or place in returns area and give customer replacement on the spot',
  'BRIGHT GREEN':
    'https://forms.monday.com/forms/4929d29d30b8b341b7db566883b1ba85?r=use1',
  'BRILLIANT LIGHTING': 'https://brilliantlighting.com.au/pages/warranty',
  'Calibo Fans': 'https://www.calibo.com.au/warranty',
  'CLA': 'customerservice@clalighting.com.au',
  'COUGAR Lighting': 'Mark MarkH@cougarlighting.com.au',
  'DOMUS Lighting': 'https://domuslighting.com.au/warranty-claim-form/',
  'EGLO Lighting':
    'https://eglo.tradieconnect.me/admincustom/api/warrantyform1/?service=4700&serviceselect=4700&status=5',
  'HAVIT Lighting': 'https://havit.com.au/pages/product-warranty-registration',
  'HUNTER PACIFIC': 'https://hunterpacificinternational.com.au/warranty-form/',
  'HUNZA Lighting':
    'There is no warranty form, however they do have a PDF on their website that explains the Terms and Conditions, and the Procedure for claiming a warranty. https://hunzalighting.com/download/hunza-australia-only-warranty/',
  'ICON FANS': 'sales@lightrays.com.au',
  'IXL':
    'https://www.ixlappliances.com.au/warranty.html?srsltid=AfmBOoqTOcyX8PcQSVRTBZpxsGvsraxNcSaje55DulchvrEhsSFdOrgy',
  'LIGHTCO': 'Troy: sales@lightco.com.au',
  'Lighting Inspirations': 'orders@lightinginspirations.com.au',
  'MAYFIELD LAMPS': 'sales@mayfieldlighting.com.au',
  'MECATOR':
    'Place in the returns area and give the customer a replacement on the spot or Katy our rep',
  'OMNI Globes':
    'Place in the returns area and give the customer a replacement',
  'ORIEL Lighting': 'sales@oriel-lighting.com.au or see Lucy',
  'PHONIX Lighting (PHL)':
    'Place in the returns area and give the customer a replacement on the spot or Katy our rep',
  'SUNNY Lighting (SAL)': 'warranty@sal.net.au',
  'SUPERLUX': 'info@superlux.com.au att: Jackie',
  'TELBIX': 'Claims@telbix.com',
  'TEC LED': 'teclec@onestream.com.au',
  'TREND Lighting': 'Jim Kapsalis : jim@trendlighting.com.au',
  'VENTAIR':
    'https://ventair.tradieconnect.me/admincustom/api/warrantyform1/?service=4700&serviceselect=4700&status=5',
  'VENCHA': 'https://www.vencha.net.au/page/15/vencha-warranty-claim-form',
};

// Case/whitespace/punctuation-insensitive key so "AQUALUX\ TELECTRAN"
// and "Lighting  Inspirations" (double space) still match.
const nameKey = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]/g, '');

@Injectable()
export class SuppliersService implements OnModuleInit {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
  ) {}

  async onModuleInit() {
    await this.ensureSeedSuppliers();
    await this.backfillWarrantyContacts();
  }

  // Make sure every supplier in the directory seed exists — additive
  // only (matched by normalised name; existing rows are never touched),
  // so a database seeded from an older, shorter list still converges on
  // the full directory. Note: a supplier deleted from the UI that is
  // still in this seed list will re-appear on the next deploy — remove
  // it from the list here to delete it permanently.
  private async ensureSeedSuppliers(): Promise<void> {
    try {
      const all = await this.supplierRepository.find();
      const existing = new Set(all.map((s) => nameKey(s.name)));
      const missing = SEED_SUPPLIERS.filter(
        (s) => !existing.has(nameKey(s.name)),
      );
      if (missing.length > 0) {
        await this.supplierRepository.save(
          missing.map((s) => this.supplierRepository.create(s)),
        );
        // eslint-disable-next-line no-console
        console.log(
          `[suppliers] added ${missing.length} missing directory supplier(s): ${missing
            .map((s) => s.name)
            .join(', ')}`,
        );
      }
    } catch (err) {
      // Never let a seed hiccup stop the app booting.
      // eslint-disable-next-line no-console
      console.error('[suppliers] directory seed failed:', err);
    }
  }

  // Fill warrantyContact from the spreadsheet map wherever it's still
  // NULL (never overwrites a staff edit — even a cleared '' value).
  // Suppliers in the map that don't exist yet are created. Idempotent;
  // runs on every boot so a redeploy picks up map additions.
  private async backfillWarrantyContacts(): Promise<void> {
    try {
      const all = await this.supplierRepository.find();
      const byKey = new Map(all.map((s) => [nameKey(s.name), s]));
      for (const [name, contact] of Object.entries(WARRANTY_CONTACTS)) {
        const existing = byKey.get(nameKey(name));
        if (existing) {
          if (existing.warrantyContact == null) {
            await this.supplierRepository.update(existing.id, {
              warrantyContact: contact,
            });
          }
        } else {
          await this.supplierRepository.save(
            this.supplierRepository.create({ name, warrantyContact: contact }),
          );
        }
      }
    } catch (err) {
      // Never let a seed hiccup stop the app booting.
      // eslint-disable-next-line no-console
      console.error('[suppliers] warranty-contact backfill failed:', err);
    }
  }

  async create(data: CreateSupplierDto): Promise<Supplier> {
    const supplier = this.supplierRepository.create({
      name: data.name.trim(),
      phone: data.phone?.trim() || null,
      rep: data.rep?.trim() || null,
      email: data.email?.trim() || null,
      notes: data.notes?.trim() || null,
      warrantyContact: data.warrantyContact?.trim() || null,
    });
    return this.supplierRepository.save(supplier);
  }

  async update(id: number, data: UpdateSupplierDto): Promise<Supplier> {
    const existing = await this.supplierRepository.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Supplier not found');
    const patch: Partial<Supplier> = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.phone !== undefined) patch.phone = data.phone?.trim() || null;
    if (data.rep !== undefined) patch.rep = data.rep?.trim() || null;
    if (data.email !== undefined) patch.email = data.email?.trim() || null;
    if (data.notes !== undefined) patch.notes = data.notes?.trim() || null;
    if (data.warrantyContact !== undefined)
      patch.warrantyContact = data.warrantyContact?.trim() || null;
    await this.supplierRepository.update(id, patch);
    return this.supplierRepository.findOne({ where: { id } }) as Promise<Supplier>;
  }

  async remove(id: number): Promise<void> {
    const existing = await this.supplierRepository.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Supplier not found');
    await this.supplierRepository.delete(id);
  }

  async findAll(search?: string): Promise<Supplier[]> {
    const where = search
      ? [
          { name: Like(`%${search}%`) },
          { rep: Like(`%${search}%`) },
          { phone: Like(`%${search}%`) },
        ]
      : undefined;
    return this.supplierRepository.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<Supplier | null> {
    return this.supplierRepository.findOne({ where: { id } });
  }
}
