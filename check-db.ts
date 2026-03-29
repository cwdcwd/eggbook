import 'dotenv/config';
import { db } from './src/lib/db';

async function main() {
  const users = await db.user.findMany({
    select: { username: true, role: true },
  });
  const sellers = await db.sellerProfile.findMany({
    select: { displayName: true, user: { select: { username: true } } },
  });
  console.log('Users:', JSON.stringify(users, null, 2));
  console.log('Sellers:', JSON.stringify(sellers, null, 2));
  process.exit(0);
}
main();
