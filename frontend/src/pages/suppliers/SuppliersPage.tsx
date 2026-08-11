import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  PhoneIcon,
  EnvelopeIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { suppliersApi } from '../../services/api';

interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  rep: string | null;
  email: string | null;
  notes: string | null;
  warrantyContact: string | null;
}

const empty = { name: '', phone: '', rep: '', email: '', notes: '', warrantyContact: '' };

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await suppliersApi.getSuppliers({ search: search || undefined });
      setSuppliers(res.data.data.suppliers);
    } catch {
      toast.error('Failed to load suppliers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openAdd = () => {
    setEditing(null);
    setForm(empty);
    setShowModal(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name || '',
      phone: s.phone || '',
      rep: s.rep || '',
      email: s.email || '',
      notes: s.notes || '',
      warrantyContact: s.warrantyContact || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await suppliersApi.updateSupplier(editing.id, form);
        toast.success('Supplier updated');
      } else {
        await suppliersApi.createSupplier(form);
        toast.success('Supplier added');
      }
      setShowModal(false);
      load();
    } catch {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: Supplier) => {
    if (!confirm(`Delete supplier "${s.name}"?`)) return;
    try {
      await suppliersApi.deleteSupplier(s.id);
      toast.success('Supplier deleted');
      load();
    } catch {
      toast.error('Delete failed');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-pos-bg text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Supplier Contact</h1>
            <p className="text-sm text-gray-400">
              Phone numbers and rep details for our lighting suppliers.
            </p>
          </div>
          <button
            onClick={openAdd}
            className="btn bg-primary-600 text-white flex items-center gap-2"
          >
            <PlusIcon className="h-5 w-5" /> Add Supplier
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, rep, or phone…"
            className="w-full pl-10 pr-3 py-2 bg-pos-card border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
          />
        </div>

        {/* Table */}
        <div className="bg-pos-card border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-pos-accent text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Rep / Contact</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : suppliers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    No suppliers found.
                  </td>
                </tr>
              ) : (
                suppliers.map((s) => (
                  <tr key={s.id} className="border-t border-gray-800 hover:bg-pos-accent/30">
                    <td className="px-4 py-3 font-semibold">{s.name}</td>
                    <td className="px-4 py-3">
                      {s.phone && (
                        <a
                          href={`tel:${s.phone.replace(/\s+/g, '')}`}
                          className="flex items-center gap-1 text-primary-400 hover:underline"
                        >
                          <PhoneIcon className="h-4 w-4" />
                          {s.phone}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {s.email && (
                        <div className="flex items-center gap-1">
                          <EnvelopeIcon className="h-4 w-4 text-gray-500" />
                          <a
                            href={`mailto:${s.email}`}
                            className="text-primary-400 hover:underline"
                          >
                            {s.email}
                          </a>
                        </div>
                      )}
                      {s.rep && (
                        <div className="flex items-center gap-1 mt-1">
                          <UserIcon className="h-4 w-4 text-gray-500" />
                          {s.rep}
                        </div>
                      )}
                      {s.notes && (
                        <div className="text-xs text-gray-500 mt-1">{s.notes}</div>
                      )}
                      {/* Warranty claims — form link, claims email, or
                          in-store instruction, straight off Sally's
                          warranty sheet. URLs/emails are clickable. */}
                      {s.warrantyContact && (
                        <div className="mt-2 text-xs rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                          <span className="font-semibold text-amber-300 uppercase tracking-wide mr-1.5">
                            Warranty:
                          </span>
                          {/^https?:\/\/\S+$/i.test(s.warrantyContact.trim()) ? (
                            <a
                              href={s.warrantyContact.trim()}
                              target="_blank"
                              rel="noreferrer"
                              className="text-amber-200 underline break-all"
                            >
                              Open warranty claim form
                            </a>
                          ) : (
                            <span className="text-amber-100 break-words">
                              {s.warrantyContact}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => openEdit(s)}
                          className="text-gray-400 hover:text-primary-400"
                          title="Edit"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
                          className="text-gray-400 hover:text-red-400"
                          title="Delete"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / edit modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className="bg-pos-card border border-gray-700 rounded-lg shadow-2xl max-w-lg w-full p-6 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4">
              {editing ? 'Edit Supplier' : 'Add Supplier'}
            </h2>
            <div className="space-y-3">
              <Field label="Name *">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                  autoFocus
                />
              </Field>
              <Field label="Phone">
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="input"
                  placeholder="e.g. 03 9765 2555"
                />
              </Field>
              <Field label="Rep / Contact Name">
                <input
                  value={form.rep}
                  onChange={(e) => setForm({ ...form, rep: e.target.value })}
                  className="input"
                  placeholder="e.g. Rob: 0412 037 701"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="input"
                  rows={3}
                />
              </Field>
              <Field label="Warranty Claims (form URL, email, or instruction)">
                <textarea
                  value={form.warrantyContact}
                  onChange={(e) =>
                    setForm({ ...form, warrantyContact: e.target.value })
                  }
                  className="input"
                  rows={2}
                  placeholder="e.g. https://…/warranty-claim-form or warranty@supplier.com.au or 'place in returns area'"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="btn bg-gray-700 text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn bg-primary-600 text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : editing ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
