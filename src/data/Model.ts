export default interface Model<R extends string, I extends string | undefined = string> {
  /**
   * Indicates the kind of entity this is.
   */
  resource: R;
  /**
   * The unique identifier for this entity.
   */
  id: I;
}
