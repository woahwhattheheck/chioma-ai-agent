/**
 * Summarizes the backend's indexed rent-obligation NFT record.
 * This is NOT a live Soroban contract query or proof of settlement.
 * Do not pass arbitrary metadata text through to the conversational model.
 */
function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeIdentifier(value: unknown, maxLength = 128): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    trimmed.length <= maxLength &&
    /^[a-zA-Z0-9_.:\/-]+$/.test(trimmed)
    ? trimmed
    : null;
}

export function explainRentObligationNft(
  agreementId: string,
  rawRecord: unknown,
): string {
  if (rawRecord === null) {
    return `No rent-obligation NFT is indexed for agreement ${agreementId}. This does not prove that no obligation exists on-chain.`;
  }

  const record = recordOf(rawRecord);
  if (!record) throw new Error('Unexpected rent-obligation NFT response');

  const returnedAgreement = safeIdentifier(record.agreementId);
  if (!returnedAgreement || returnedAgreement !== agreementId) {
    throw new Error('Rent-obligation NFT record does not match the requested agreement');
  }

  const status = record.status;
  const statusText =
    status === 'active' ? 'active' :
    status === 'disputed' ? 'disputed' :
    status === 'burned' ? 'burned' : 'not reported';

  const facts = [
    `The indexed rent-obligation NFT for agreement ${agreementId} is ${statusText}.`,
  ];

  const tokenId = safeIdentifier(record.tokenId);
  if (tokenId) facts.push(`Token ID: ${tokenId}.`);

  const owner = safeIdentifier(record.currentOwner, 160);
  if (owner) facts.push(`Recorded owner: ${owner}.`);

  if (typeof record.isActive === 'boolean') {
    facts.push(`Backend active flag: ${record.isActive ? 'yes' : 'no'}.`);
  }

  const count = record.transferCount;
  if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
    facts.push(`Recorded transfers: ${count}.`);
  }

  const metadata = recordOf(record.metadata);
  const monthlyRent = metadata?.monthlyRent;
  if (
    (typeof monthlyRent === 'string' && /^\d+(?:\.\d+)?$/.test(monthlyRent)) ||
    (typeof monthlyRent === 'number' && Number.isFinite(monthlyRent) && monthlyRent >= 0)
  ) {
    facts.push(`Lease rent recorded in NFT metadata: ${monthlyRent} (currency/unit not specified by this field).`);
  }

  facts.push(
    'This is the Chioma backend\'s indexed record, not a fresh on-chain ownership check. Token status alone does not establish rent payment, outstanding balance, or escrow release.',
  );
  return facts.join(' ');
}
