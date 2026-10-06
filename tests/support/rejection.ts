/**
 * The message a promise rejects with. bun-types declares
 * `expect(p).rejects.toThrow()` as returning void, so TypeScript flags the
 * `await` it needs at run time; awaiting this instead keeps both happy.
 */
export const rejectionMessage = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the promise to reject");
};
