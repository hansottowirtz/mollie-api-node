import TransformingNetworkClient from '../../communication/TransformingNetworkClient';
import List from '../../data/list/List';
import Permission, { PermissionData } from '../../data/permissions/Permission';
import ApiError from '../../errors/ApiError';
import checkId from '../../plumbing/checkId';
import renege from '../../plumbing/renege';
import Callback from '../../types/Callback';
import Binder from '../Binder';

const pathSegment = 'permissions';

export default class PermissionsBinder extends Binder<PermissionData, Permission> {
  constructor(protected readonly networkClient: TransformingNetworkClient) {
    super();
  }

  /**
   * List all permissions available with the current app access token. The list is not paginated.
   *
   * @since 3.2.0
   * @deprecated Use `page` instead.
   * @see https://docs.mollie.com/reference/v2/permissions-api/list-permissions
   */
  public list: PermissionsBinder['page'] = this.page;

  /**
   * All API actions through OAuth are by default protected for privacy and/or money related reasons and therefore require specific permissions. These permissions can be requested by apps during the
   * OAuth authorization flow. The Permissions resource allows the app to check whether an API action is (still) allowed by the authorization.
   *
   * @since 3.2.0
   * @see https://docs.mollie.com/reference/v2/permissions-api/get-permission
   */
  public get(id: string): Promise<Permission>;
  public get(id: string, callback: Callback<Permission>): void;
  public get(id: string) {
    if (renege(this, this.get, ...arguments)) return;
    if (!checkId(id, 'permission')) {
      throw new ApiError('The permission id is invalid');
    }
    return this.networkClient.get<PermissionData, Permission>(`${pathSegment}/${id}`);
  }

  /**
   * List all permissions available with the current app access token. The list is not paginated.
   *
   * @since 3.2.0 (as `list`)
   * @see https://docs.mollie.com/reference/v2/permissions-api/list-permissions
   */
  public page(): Promise<List<Permission>>;
  public page(callback: Callback<List<Permission>>): void;
  public page() {
    if (renege(this, this.page, ...arguments)) return;
    return this.networkClient.list<PermissionData, Permission>(pathSegment, 'permissions', {}).then(result => this.injectPaginationHelpers<undefined>(result, this.page, undefined));
  }
}
