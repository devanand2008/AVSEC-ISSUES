import '../../core/network/avs_api_client.dart';
import 'auth_user.dart';

class AuthRepository {
  AuthRepository({AvsApiClient? client}) : client = client ?? AvsApiClient();

  final AvsApiClient client;

  Future<AuthUser> restore() async {
    final data = await client.get('/auth/me') as Map<String, dynamic>;
    return AuthUser.fromJson(data);
  }

  Future<AuthUser> login({
    required String identifier,
    required String password,
    String? collegeCode,
  }) async {
    final data = await client.login(
      identifier: identifier,
      password: password,
      collegeCode: collegeCode,
    );
    return AuthUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<AuthUser> changeFirstPassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final data = await client.post('/auth/change-first-password', {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    }) as Map<String, dynamic>;
    return AuthUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<void> logout() => client.logout();
}
