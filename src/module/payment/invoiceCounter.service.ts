import { InvoiceCounter, TInvoiceCounterType } from "./invoiceCounter.model";

const getNextInvoiceSequence = async (
  type: TInvoiceCounterType,
  session?: import("mongoose").ClientSession | null,
): Promise<number> => {
  const updated = await InvoiceCounter.findOneAndUpdate(
    { type },
    { $inc: { lastSequence: 1 } },
    {
      upsert: true,
      returnDocument: "after",
      session,
    },
  );

  return updated!.lastSequence;
};

export const InvoiceCounterService = {
  getNextInvoiceSequence,
};
