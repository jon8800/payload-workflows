import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email' },
  auth: true,
  fields: [],
}

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: { defaultColumns: ['title', 'status', 'featured', 'updatedAt'], useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'draft',
      options: ['draft', 'published'],
      admin: { position: 'sidebar' },
    },
    { name: 'featured', type: 'checkbox', admin: { position: 'sidebar' } },
    { name: 'authorEmail', type: 'email' },
    { name: 'body', type: 'textarea' },
  ],
}

export const Activity: CollectionConfig = {
  slug: 'activity',
  admin: { defaultColumns: ['message', 'createdAt'], useAsTitle: 'message' },
  fields: [{ name: 'message', type: 'text', required: true }],
}
