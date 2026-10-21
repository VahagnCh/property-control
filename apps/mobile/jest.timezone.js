if (process.env.TZ !== 'America/Mexico_City') {
  throw new Error(
    `Jest must start with TZ=America/Mexico_City (received ${process.env.TZ ?? 'unset'}). Use pnpm test.`,
  );
}
