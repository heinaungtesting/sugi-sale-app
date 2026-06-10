'use client';

import { useState } from 'react';

type AdminProduct = { id: number; product_name: string; category: string | null; point_value: number; nicknames: string[]; is_active: boolean; variants: Array<{ id: number; product_id: number; variant_label: string; display_shortcut: string | null; unit_count: number; point_value: number; nicknames: string[]; is_active: boolean }> };
type AdminUser = { id: number; username: string; display_name: string; role: string; is_active: boolean };

export function AdminClient({ initialUsers, initialProducts }: { initialUsers: AdminUser[]; initialProducts: AdminProduct[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [products, setProducts] = useState(initialProducts);
  async function reload() {
    setUsers(await (await fetch('/api/admin/users')).json());
    setProducts(await (await fetch('/api/admin/products')).json());
  }
  async function saveUser(form: FormData) {
    const obj = Object.fromEntries(form);
    await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...obj, is_active: obj.is_active === 'on' }) });
    await reload();
  }
  async function saveProduct(form: FormData) {
    const obj = Object.fromEntries(form);
    await fetch('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...obj, is_active: obj.is_active === 'on' }) });
    await reload();
  }
  async function saveVariant(form: FormData) {
    const obj = Object.fromEntries(form);
    await fetch('/api/admin/variants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...obj, is_active: obj.is_active === 'on' }) });
    await reload();
  }

  return (
    <section className="admin-page">
      <h2>Users</h2>
      <form action={saveUser} className="admin-card">
        <input name="username" placeholder="username" required />
        <input name="display_name" placeholder="display name" required />
        <input name="pin" placeholder="PIN" required />
        <select name="role"><option value="user">user</option><option value="admin">admin</option></select>
        <button className="primary">Create user</button>
      </form>
      {users.map((user) => (
        <form key={user.id} action={saveUser} className="admin-card compact">
          <input type="hidden" name="id" value={user.id} />
          <input name="username" defaultValue={user.username} />
          <input name="display_name" defaultValue={user.display_name} />
          <input name="pin" placeholder="new PIN blank=keep" />
          <select name="role" defaultValue={user.role}><option value="user">user</option><option value="admin">admin</option></select>
          <label><input type="checkbox" name="is_active" defaultChecked={user.is_active} /> active</label>
          <button>Save</button>
        </form>
      ))}
      <h2>Products</h2>
      <form action={saveProduct} className="admin-card">
        <input name="product_name" placeholder="Product family / base product" required />
        <input name="category" placeholder="category" />
        <input name="point_value" type="number" placeholder="fallback points" defaultValue="0" />
        <input name="nicknames" placeholder="aliases comma-separated" />
        <label><input type="checkbox" name="is_active" defaultChecked /> active</label>
        <button className="primary">Add product</button>
      </form>
      {products.map((product) => (
        <section key={product.id} className="admin-card">
          <form action={saveProduct} className="admin-grid">
            <input type="hidden" name="id" value={product.id} />
            <input name="product_name" defaultValue={product.product_name} />
            <input name="category" defaultValue={product.category ?? ''} />
            <input name="point_value" type="number" defaultValue={product.point_value} />
            <input name="nicknames" defaultValue={(product.nicknames ?? []).join(', ')} />
            <label><input type="checkbox" name="is_active" defaultChecked={product.is_active} /> active</label>
            <button>Edit product</button>
          </form>
          <h3>Variants</h3>
          {product.variants.map((variant) => (
            <form key={variant.id} action={saveVariant} className="admin-grid">
              <input type="hidden" name="id" value={variant.id} />
              <input type="hidden" name="product_id" value={product.id} />
              <input name="variant_label" defaultValue={variant.variant_label} />
              <input name="display_shortcut" defaultValue={variant.display_shortcut ?? ''} placeholder="shortcut: 7 / gel" />
              <input name="unit_count" type="number" defaultValue={variant.unit_count} />
              <input name="point_value" type="number" defaultValue={variant.point_value} />
              <input name="nicknames" defaultValue={(variant.nicknames ?? []).join(', ')} />
              <label><input type="checkbox" name="is_active" defaultChecked={variant.is_active} /> active</label>
              <button>Edit</button>
            </form>
          ))}
          <form action={saveVariant} className="admin-grid">
            <input type="hidden" name="product_id" value={product.id} />
            <input name="variant_label" placeholder="7錠 / gel" />
            <input name="display_shortcut" placeholder="shortcut: 7 / gel" />
            <input name="unit_count" type="number" defaultValue="1" />
            <input name="point_value" type="number" placeholder="points" />
            <input name="nicknames" placeholder="aliases" />
            <label><input type="checkbox" name="is_active" defaultChecked /> active</label>
            <button>+ Add variant</button>
          </form>
        </section>
      ))}
    </section>
  );
}
