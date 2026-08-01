import { useRef, CSSProperties } from 'react';
import { XMarkIcon, PrinterIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { CartItem } from '../../../store/slices/cartSlice';

// Company block printed at the top + footer of every invoice. Matches the
// legal Australian Lighting & Fans (Sunridge) tax-invoice template.
const COMPANY = {
  brandLight: 'AUSTRALIAN',
  brandAccent: 'LIGHTING',
  legalName: 'SUNRIDGE AUSTRALIA T/A AUSTRALIAN LIGHTING & FANS CLAYTON',
  abn: '24 068 282 959',
  phone: '(03) 9548 9200',
  email: 'info@australianlighting.com.au',
  address: '1704 Princes Hwy, Oakleigh East VIC 3166',
  payeeName: 'Sunridge Australian Pty Ltd',
  bsb: '123-621',
  account: '21502941',
};

// Invoice is fully monochrome per client request — the wordmark, date,
// and balance all render in INK. ORANGE is kept as an alias pointing to
// INK so any downstream use resolves to black without renaming every
// call site.
const INK = '#111827';
const ORANGE = INK;
const MUTED = '#6b7280';
const RULE = '#e5e7eb';

interface InvoiceData {
  orderNumber: string;
  date: string;
  updatedAt?: string;
  buyerType: 'retail' | 'customer';
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  companyAbn?: string;
  items: (CartItem & { isBackorder?: boolean; isLaybyHeld?: boolean })[];
  subtotal: number;
  itemDiscounts: number;
  cartDiscount: number;
  taxAmount: number;
  grandTotal: number;
  // Delivery fee that's baked into grandTotal. Rendered as a separate
  // "DELIVERY" line in the totals block when > 0 so the customer sees
  // the freight charge itemised.
  deliveryFee?: number;
  deliveryType?: string;
  paymentMethod: string;
  cashTendered?: number;
  change?: number;
  isLayby?: boolean;
  isBackorder?: boolean;
  isMixed?: boolean;
  amountPaid?: number;
  balanceDue?: number;
  takeNowSubtotal?: number;
  deferredSubtotal?: number;
  salesPerson?: string;
  notes?: string;
}

interface InvoiceModalProps {
  invoice: InvoiceData;
  onClose: () => void;
}

const formatDate = (s?: string) =>
  s
    ? new Date(s).toLocaleDateString('en-AU', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '';

const money = (n: number) =>
  `$${(n || 0).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Split the comma-joined address into two visual lines: the first is the
// street, the rest collapses into a single suburb/state/postcode line.
function splitAddress(addr?: string): { line1: string; line2: string } {
  if (!addr) return { line1: '', line2: '' };
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { line1: parts[0] || '', line2: '' };
  return { line1: parts[0], line2: parts.slice(1).join(' ') };
}

export default function InvoiceModal({ invoice, onClose }: InvoiceModalProps) {
  const invoiceRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const printContent = invoiceRef.current;
    if (!printContent) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice ${invoice.orderNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
              color: ${INK};
              padding: 24px;
            }
            .invoice-container { max-width: 820px; margin: 0 auto; }
            @page { size: A4; margin: 14mm; }
            @media print {
              body { padding: 0; }
              .no-print { display: none !important; }
            }
          </style>
        </head>
        <body>${printContent.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleSavePdf = async () => {
    const node = invoiceRef.current;
    if (!node) return;
    const html2pdf = (await import('html2pdf.js')).default;
    await html2pdf()
      .set({
        margin: 10,
        filename: `Invoice-${invoice.orderNumber}.pdf`,
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        html2canvas: { scale: 2, useCORS: true },
      })
      .from(node)
      .save();
  };

  const addr = splitAddress(invoice.customerAddress);
  const showDeposit =
    typeof invoice.balanceDue === 'number' && invoice.balanceDue > 0.01;

  // Aggregate qty splits across the order so we can render per-line
  // TAKEN / B-ORDER / LAY-BY columns matching the printed template.
  const rows = invoice.items.map((it) => ({
    qty: it.quantity,
    name: it.name,
    sku: it.sku,
    unitPrice: it.unitPrice,
    rowTotal: it.rowTotal,
    takenQty: it.isBackorder || it.isLaybyHeld ? 0 : it.quantity,
    backorderQty: it.isBackorder ? it.quantity : 0,
    laybyQty: it.isLaybyHeld ? it.quantity : 0,
    // Flag clearance/sale lines so the printed invoice shows why the
    // price differs from the ticketed RRP.
    isSale: !!it.isSaleItem,
  }));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gray-800 text-white p-4 flex items-center justify-between z-10 no-print">
          <h2 className="text-lg font-bold">Invoice Preview</h2>
          <div className="flex items-center gap-3">
            <button className="btn-sm bg-primary-600 text-white flex items-center gap-2" onClick={handlePrint}>
              <PrinterIcon className="h-4 w-4" /> Print
            </button>
            <button className="btn-sm bg-green-600 text-white flex items-center gap-2" onClick={handleSavePdf}>
              <ArrowDownTrayIcon className="h-4 w-4" /> Save PDF
            </button>
            <button className="text-gray-400 hover:text-white" onClick={onClose}>
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div
          ref={invoiceRef}
          className="invoice-container p-8"
          style={{
            color: INK,
            backgroundColor: '#fff',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '13px',
            lineHeight: 1.45,
          }}
        >
          {/* Header — brand wordmark left, TAX INVOICE block right */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '14px' }}>
            <div>
              <div style={{ fontSize: '28px', fontWeight: 900, letterSpacing: '-0.5px' }}>
                <span style={{ color: INK }}>{COMPANY.brandLight} </span>
                <span style={{ color: ORANGE }}>{COMPANY.brandAccent}</span>
              </div>
              <div style={{ marginTop: '6px', fontSize: '11px', color: MUTED, letterSpacing: '0.3px' }}>
                {COMPANY.legalName}
              </div>
              <div style={{ fontSize: '11px', color: MUTED, marginTop: '2px' }}>
                ABN {COMPANY.abn}
              </div>
            </div>
            <div style={{ textAlign: 'right', minWidth: '220px' }}>
              <div style={{ fontSize: '11px', color: MUTED, letterSpacing: '1px' }}>TAX INVOICE</div>
              <div style={{ fontSize: '11px', color: MUTED, marginTop: '8px', letterSpacing: '1px' }}>INVOICE NO.</div>
              <div style={{ marginTop: '6px', border: `1px solid ${INK}`, padding: '10px 14px', fontSize: '22px', fontWeight: 800 }}>
                {invoice.orderNumber}
              </div>
            </div>
          </div>

          {/* Contact strip */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}`, fontSize: '12px', color: MUTED }}>
            <span>{COMPANY.phone}</span>
            <span style={{ flex: 1, textAlign: 'center' }}>{COMPANY.email}</span>
            <span>{COMPANY.address}</span>
          </div>

          {/* Bill To / Invoice meta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '22px', gap: '40px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', color: MUTED, letterSpacing: '1px', marginBottom: '6px' }}>BILL TO</div>
              {invoice.customerName && (
                <div style={{ fontSize: '15px', fontWeight: 800, color: INK }}>{invoice.customerName}</div>
              )}
              {invoice.customerCompany && (
                <div style={{ marginTop: '2px' }}>{invoice.customerCompany}</div>
              )}
              {(addr.line1 || addr.line2) && (
                <>
                  <div style={{ fontSize: '11px', color: MUTED, marginTop: '10px' }}>Address</div>
                  {addr.line1 && <div>{addr.line1}</div>}
                  {addr.line2 && <div style={{ textTransform: 'uppercase' }}>{addr.line2}</div>}
                </>
              )}
              {invoice.customerPhone && (
                <>
                  <div style={{ fontSize: '11px', color: MUTED, marginTop: '10px' }}>Phone</div>
                  <div>{invoice.customerPhone}</div>
                </>
              )}
              {invoice.customerEmail && (
                <>
                  <div style={{ fontSize: '11px', color: MUTED, marginTop: '10px' }}>Email</div>
                  <div>{invoice.customerEmail}</div>
                </>
              )}
            </div>

            <div style={{ width: '300px' }}>
              <div style={{ fontSize: '11px', color: MUTED, letterSpacing: '1px' }}>INVOICE DATE</div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: ORANGE, marginTop: '2px' }}>
                {formatDate(invoice.date)}
              </div>
              <table style={{ marginTop: '14px', width: '100%', fontSize: '12px' }}>
                <tbody>
                  <tr>
                    <td style={{ color: MUTED, paddingRight: '12px', verticalAlign: 'top' }}>Invoice Number:</td>
                    <td>{invoice.orderNumber}</td>
                  </tr>
                  {invoice.updatedAt && (
                    <tr>
                      <td style={{ color: MUTED, paddingRight: '12px', verticalAlign: 'top' }}>Updated on:</td>
                      <td>{formatDate(invoice.updatedAt)}</td>
                    </tr>
                  )}
                  {invoice.salesPerson && (
                    <>
                      <tr>
                        <td style={{ color: MUTED, paddingRight: '12px', verticalAlign: 'top' }}>Updated by:</td>
                        <td>{invoice.salesPerson}</td>
                      </tr>
                      <tr>
                        <td style={{ color: MUTED, paddingRight: '12px', verticalAlign: 'top' }}>Lighting consultant:</td>
                        <td>{invoice.salesPerson}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Items table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderTop: `1px solid ${INK}`, borderBottom: `1px solid ${INK}` }}>
                <th style={th('center', 56)}>QTY</th>
                <th style={th('left')}>PRODUCT DESCRIPTION</th>
                <th style={th('right', 90)}>UNIT PRICE*</th>
                <th style={th('center', 60)}>TAKEN</th>
                <th style={th('center', 70)}>B/ORDER</th>
                <th style={th('center', 70)}>LAY-BY</th>
                <th style={th('right', 100)}>TOTAL*</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${RULE}` }}>
                  <td style={td('center')}>{r.qty}</td>
                  <td style={td('left')}>
                    {r.name}
                    {r.sku ? (
                      <span style={{ color: MUTED, fontSize: '11px' }}> — {r.sku}</span>
                    ) : null}
                    {r.isSale ? (
                      <span
                        style={{
                          marginLeft: 6,
                          padding: '1px 5px',
                          border: `1px solid ${INK}`,
                          borderRadius: 3,
                          fontSize: '9px',
                          fontWeight: 800,
                          letterSpacing: '0.04em',
                          verticalAlign: 'middle',
                        }}
                      >
                        SALE
                      </span>
                    ) : null}
                  </td>
                  <td style={td('right')}>{money(r.unitPrice)}</td>
                  <td style={td('center')}>{r.takenQty || ''}</td>
                  <td style={td('center')}>{r.backorderQty || ''}</td>
                  <td style={td('center')}>{r.laybyQty || ''}</td>
                  <td style={td('right')}>{money(r.rowTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals — right-aligned block */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
            <table style={{ width: '320px', fontSize: '13px' }}>
              <tbody>
                <tr>
                  <td style={totLabel}>SUBTOTAL</td>
                  <td style={totVal(true)}>{money(invoice.grandTotal)}</td>
                </tr>
                <tr>
                  <td style={totLabel}>GOODS TAKEN:</td>
                  <td style={totVal()}>
                    {invoice.takeNowSubtotal != null ? money(invoice.takeNowSubtotal) : ''}
                  </td>
                </tr>
                {showDeposit && (
                  <tr>
                    <td style={totLabel}>DEPOSIT:</td>
                    <td style={totVal()}>{money(invoice.amountPaid || 0)}</td>
                  </tr>
                )}
                {invoice.deliveryFee != null && invoice.deliveryFee > 0 && (
                  <tr>
                    <td style={totLabel}>
                      DELIVERY
                      {invoice.deliveryType && invoice.deliveryType !== 'delivery'
                        ? ` (${invoice.deliveryType.replace(/_/g, ' ')})`
                        : ''}
                      :
                    </td>
                    <td style={totVal()}>{money(invoice.deliveryFee)}</td>
                  </tr>
                )}
                <tr>
                  <td style={totLabel}>INCLUDES GST:</td>
                  <td style={totVal()}>{money(invoice.taxAmount)}</td>
                </tr>
                <tr>
                  <td style={{ ...totLabel, fontWeight: 800, color: INK, paddingTop: '12px' }}>BALANCE:</td>
                  <td
                    style={{
                      ...totVal(true),
                      color: ORANGE,
                      paddingTop: '12px',
                      fontSize: '16px',
                    }}
                  >
                    {money(showDeposit ? invoice.balanceDue! : invoice.grandTotal)}
                  </td>
                </tr>
                {invoice.cashTendered != null && (
                  <>
                    <tr>
                      <td style={totLabel}>Cash Tendered:</td>
                      <td style={totVal()}>{money(invoice.cashTendered)}</td>
                    </tr>
                    <tr>
                      <td style={totLabel}>Change:</td>
                      <td style={totVal()}>{money(invoice.change || 0)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* NOTES box */}
          <div style={{ marginTop: '22px', border: `1px solid ${RULE}`, padding: '12px', minHeight: '60px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: INK, letterSpacing: '0.5px' }}>NOTES:</div>
            {invoice.notes && (
              <div style={{ marginTop: '6px', fontSize: '12px', whiteSpace: 'pre-wrap' }}>{invoice.notes}</div>
            )}
          </div>

          {/* Legal / signature row */}
          <div style={{ display: 'flex', gap: '40px', marginTop: '22px', borderTop: `1px solid ${RULE}`, paddingTop: '14px', fontSize: '11px', color: MUTED }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: INK }}>*PRICES GST INCLUSIVE</div>
              <div style={{ marginTop: '14px' }}>Goods checked and received :</div>
              <div style={{ marginTop: '18px', borderBottom: `1px solid ${INK}`, height: '0' }} />
              <div style={{ marginTop: '14px', fontWeight: 800, color: INK }}>
                *RETURNS & REFUNDS ACCEPTED WITHIN 30 DAYS<br />OF PURCHASE ONLY*
              </div>
            </div>
            <div style={{ flex: 1.4 }}>
              <div style={{ fontWeight: 800, color: INK }}>CONDITIONS OF SALE:</div>
              <p style={{ marginTop: '4px' }}>
                NO EXCHANGE OR REFUND WITHOUT RECEIPT. NO REFUND FOR CHANGE OF MIND.
                RETURNS & REFUNDS ACCEPTED WITHIN 30 DAYS OF PURCHASE ONLY.
                GOODS PURCHASED OR MANUFACTURED TO ORDER ARE NOT RETURNABLE OR REFUNDABLE. DISCONTINUED,
                EX-DISPLAY, LED STRIP & CUSTOM MADE ITEMS CANNOT BE RETURNED OR EXCHANGED. ANY APPROVED RETURN
                SUBJECT TO A 20% RESTOCKING CHARGE.
                TITLE OF GOODS REMAIN PROPERTY OF AUSTRALIAN LIGHTING UNTIL PAID IN FULL. ANY STATED DELIVERY DATE
                MAY BE SUBJECT TO DELAYS BEYOND OUR CONTROL.
                QUOTES VALID 30 DAYS. CREDITS VALID 12 MONTHS.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', gap: '20px', marginTop: '18px', borderTop: `1px solid ${RULE}`, paddingTop: '12px', fontSize: '11px', color: MUTED }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: INK }}>DIRECT ALL INQUIRIES TO:</div>
              <div>{COMPANY.email}</div>
            </div>
            <div style={{ flex: 1.2 }}>
              <div style={{ fontWeight: 800, color: INK }}>MAKE ALL PAYMENTS PAYABLE TO:</div>
              <div>{COMPANY.payeeName}</div>
              <div>BSB: {COMPANY.bsb} A/C: {COMPANY.account}</div>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>#Globes not included unless otherwise stated.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const th = (align: 'left' | 'center' | 'right', width?: number): CSSProperties => ({
  padding: '8px 6px',
  textAlign: align,
  fontWeight: 800,
  fontSize: '11px',
  letterSpacing: '0.4px',
  color: INK,
  ...(width ? { width: `${width}px` } : {}),
});

const td = (align: 'left' | 'center' | 'right'): CSSProperties => ({
  padding: '10px 6px',
  textAlign: align,
  verticalAlign: 'top',
});

const totLabel: CSSProperties = {
  padding: '6px 0',
  color: MUTED,
  fontWeight: 700,
  textAlign: 'right',
  paddingRight: '14px',
  fontSize: '12px',
  letterSpacing: '0.4px',
};

const totVal = (bold = false): CSSProperties => ({
  padding: '6px 0',
  textAlign: 'right',
  fontWeight: bold ? 800 : 500,
  minWidth: '120px',
});
