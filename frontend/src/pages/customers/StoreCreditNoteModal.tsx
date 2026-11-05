import { useRef, useState } from 'react';
import {
  XMarkIcon,
  PrinterIcon,
  ArrowDownTrayIcon,
  EnvelopeIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { downloadEmailDraft } from '../../utils/emailDraft';
import { formatPhone } from '../../utils/phone';
import { COMPANY } from '../pos/components/InvoiceModal';

// A note for one store credit, to print or email to the customer (Sally,
// 5 Nov 2026: a $20 credit given over email to a customer who wasn't in
// the store — "have a template made up that we can have email or print
// for store credit"). Same paper style, Save PDF and Outlook draft as the
// invoice. The staff note on the credit ("Authorized by Sally") stays off
// it; the message to the customer is filled in and can be changed.

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';

export interface StoreCreditNoteData {
  transactionId: number;
  type: string;
  amount: number;
  createdAt: string;
  expiresAt?: string | null;
  // Credit available on the account today, all credits together.
  balance: number;
  customerName: string;
  customerCompany?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}

const formatDate = (s?: string | null) =>
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

const defaultMessage = (note: StoreCreditNoteData) =>
  (note.type === 'refund_issue'
    ? `Your return has been credited to your account as ${money(note.amount)} store credit.`
    : `We have added ${money(note.amount)} store credit to your account.`) +
  ' You can put it towards your next purchase with us.';

export default function StoreCreditNoteModal({
  note,
  onClose,
}: {
  note: StoreCreditNoteData;
  onClose: () => void;
}) {
  const noteRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState(() => defaultMessage(note));
  const reference = `SC-${note.transactionId}`;
  const issued = formatDate(note.createdAt);
  const validUntil = formatDate(note.expiresAt);

  const handlePrint = () => {
    const content = noteRef.current;
    if (!content) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Store Credit ${reference}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
              color: ${INK};
              padding: 24px;
            }
            .invoice-container { max-width: 820px; margin: 0 auto; }
            @page { size: A4; margin: 14mm; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>${content.innerHTML}</body>
      </html>
    `);
    w.document.close();
    w.print();
  };

  const pdfName = `Store-Credit-${reference}.pdf`;
  const pdfOptions = {
    margin: 10,
    filename: pdfName,
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
    html2canvas: { scale: 2, useCORS: true },
  };

  const handleSavePdf = async () => {
    const node = noteRef.current;
    if (!node) return;
    const html2pdf = (await import('html2pdf.js')).default;
    await html2pdf().set(pdfOptions).from(node).save();
  };

  // Outlook draft with the PDF attached, worded like Sally's invoice
  // email (16 Sep 2026).
  const [emailBusy, setEmailBusy] = useState(false);
  const handleEmail = async () => {
    if (emailBusy) return;
    const node = noteRef.current;
    if (!node) return;
    const name = note.customerName.trim();
    const body =
      `Hi${name ? ` ${name}` : ''},\n\n` +
      `${message.trim()}\n\n` +
      `Your store credit note is attached for your records.\n\n` +
      `Store credit details:\n` +
      `- Reference: ${reference}\n` +
      `- Amount: ${money(note.amount)}\n` +
      `- Date Issued: ${issued}\n` +
      (validUntil ? `- Valid Until: ${validUntil}\n` : '') +
      `- Available Balance: ${money(note.balance)}\n\n` +
      `To use it, just give us your name or phone number when you shop with us. ` +
      `There's no need to bring the note.\n\n` +
      `If you have any questions, simply reply to email ` +
      `info@australianlighting.com.au or contact us on 03 9548 9200 (option 1)\n\n` +
      `Thank you for choosing\nAustralian Lighting\n\n` +
      `1704 Dandenong Rd\nOakleigh East Vic 3166\n03 9548 9200\n`;
    setEmailBusy(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const pdf = (await html2pdf().set(pdfOptions).from(node).outputPdf('blob')) as Blob;
      await downloadEmailDraft({
        to: (note.customerEmail || '').trim(),
        subject: `Store credit ${reference} — Australian Lighting`,
        body,
        pdf,
        pdfName,
        emlName: `Store-Credit-${reference}.eml`,
      });
    } catch {
      toast.error('Could not build the email — use Save PDF and attach it manually');
    } finally {
      setEmailBusy(false);
    }
  };

  const label = { fontSize: '11px', color: MUTED, letterSpacing: '1px' } as const;

  return (
    <div className="modal-backdrop-top" onClick={onClose}>
      <div
        className="paper bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gray-800 text-pos-text p-4 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Store Credit Note</h2>
            <div className="flex items-center gap-3">
              <button className="btn-sm bg-primary-600 text-white flex items-center gap-2" onClick={handlePrint}>
                <PrinterIcon className="h-4 w-4" /> Print
              </button>
              <button className="btn-sm bg-green-600 text-white flex items-center gap-2" onClick={handleSavePdf}>
                <ArrowDownTrayIcon className="h-4 w-4" /> Save PDF
              </button>
              <button
                className="btn-sm bg-blue-600 text-white flex items-center gap-2 disabled:opacity-60"
                onClick={handleEmail}
                disabled={emailBusy}
                title={
                  note.customerEmail
                    ? `Creates an email to ${note.customerEmail} with the note attached as a PDF`
                    : 'Creates an email with the note attached as a PDF. Type the customer address in Outlook'
                }
              >
                <EnvelopeIcon className="h-4 w-4" /> {emailBusy ? 'Preparing…' : 'Email'}
              </button>
              <button className="text-gray-400 hover:text-pos-text" onClick={onClose}>
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
          </div>
          <label className="block text-xs text-gray-400 mt-3 mb-1">
            Message to the customer (printed on the note and used in the email)
          </label>
          <textarea
            className="input min-h-[64px] text-sm"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        <div
          ref={noteRef}
          className="invoice-container p-8"
          style={{
            color: INK,
            backgroundColor: '#fff',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '13px',
            lineHeight: 1.45,
          }}
        >
          {/* Header: wordmark left, STORE CREDIT + reference right */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '14px' }}>
            <div>
              <div style={{ fontSize: '28px', fontWeight: 900, letterSpacing: '-0.5px' }}>
                {COMPANY.brandLight} {COMPANY.brandAccent}
              </div>
              <div style={{ marginTop: '6px', fontSize: '11px', color: MUTED, letterSpacing: '0.3px' }}>
                {COMPANY.legalName}
              </div>
              <div style={{ fontSize: '11px', color: MUTED, marginTop: '2px' }}>ABN {COMPANY.abn}</div>
            </div>
            <div style={{ textAlign: 'right', minWidth: '220px' }}>
              <div style={label}>STORE CREDIT</div>
              <div style={{ ...label, marginTop: '8px' }}>REFERENCE NO.</div>
              <div style={{ marginTop: '6px', border: `1px solid ${INK}`, padding: '10px 14px', fontSize: '22px', fontWeight: 800 }}>
                {reference}
              </div>
            </div>
          </div>

          {/* Contact strip */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}`, fontSize: '12px', color: MUTED }}>
            <span>{COMPANY.phone}</span>
            <span style={{ flex: 1, textAlign: 'center' }}>{COMPANY.email}</span>
            <span>{COMPANY.address}</span>
          </div>

          {/* Issued to / dates */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '22px', gap: '40px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...label, marginBottom: '6px' }}>ISSUED TO</div>
              {note.customerCompany ? (
                <>
                  <div style={{ fontSize: '15px', fontWeight: 800 }}>{note.customerCompany}</div>
                  {note.customerName &&
                    note.customerName.trim().toLowerCase() !== note.customerCompany.trim().toLowerCase() && (
                      <div style={{ marginTop: '2px' }}>{note.customerName}</div>
                    )}
                </>
              ) : (
                <div style={{ fontSize: '15px', fontWeight: 800 }}>{note.customerName}</div>
              )}
              {note.customerPhone && (
                <>
                  <div style={{ fontSize: '11px', color: MUTED, marginTop: '10px' }}>Phone</div>
                  <div>{formatPhone(note.customerPhone)}</div>
                </>
              )}
              {note.customerEmail && (
                <>
                  <div style={{ fontSize: '11px', color: MUTED, marginTop: '10px' }}>Email</div>
                  <div>{note.customerEmail}</div>
                </>
              )}
            </div>
            <div style={{ width: '300px' }}>
              <div style={label}>DATE ISSUED</div>
              <div style={{ fontSize: '15px', fontWeight: 800, marginTop: '2px' }}>{issued}</div>
              {validUntil && (
                <>
                  <div style={{ ...label, marginTop: '14px' }}>VALID UNTIL</div>
                  <div style={{ fontSize: '15px', fontWeight: 800, marginTop: '2px' }}>{validUntil}</div>
                </>
              )}
            </div>
          </div>

          {/* The credit */}
          <div style={{ marginTop: '28px', border: `2px solid ${INK}`, padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '1px' }}>STORE CREDIT VALUE</div>
            <div style={{ fontSize: '34px', fontWeight: 900 }}>{money(note.amount)}</div>
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: MUTED, textAlign: 'right' }}>
            Store credit available on your account today: <b style={{ color: INK }}>{money(note.balance)}</b>
          </div>

          {message.trim() && (
            <div style={{ marginTop: '22px', fontSize: '14px', whiteSpace: 'pre-wrap' }}>{message.trim()}</div>
          )}

          {/* How to use it */}
          <div style={{ marginTop: '26px', borderTop: `1px solid ${RULE}`, paddingTop: '14px', fontSize: '12px' }}>
            <div style={{ fontWeight: 800, letterSpacing: '0.5px' }}>HOW TO USE YOUR STORE CREDIT</div>
            <ul style={{ marginTop: '6px', paddingLeft: '18px', listStyle: 'disc', color: MUTED }}>
              <li>
                The credit is held on your customer account. Just give us your name or phone number when you shop
                with us, in our showroom or over the phone. There's no need to bring this note.
              </li>
              <li>
                {validUntil
                  ? `Valid until ${validUntil} (12 months from the date of issue).`
                  : 'Valid for 12 months from the date of issue.'}
              </li>
              <li>It can't be used on our website.</li>
            </ul>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', gap: '20px', marginTop: '22px', borderTop: `1px solid ${RULE}`, paddingTop: '12px', fontSize: '11px', color: MUTED }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: INK }}>DIRECT ALL INQUIRIES TO:</div>
              <div>{COMPANY.email}</div>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={{ fontWeight: 800, color: INK }}>PHONE:</div>
              <div>{COMPANY.phone}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
