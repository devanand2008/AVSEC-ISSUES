import 'dart:async';

import 'package:avs_college_flutter/core/network/avs_api_client.dart';
import 'package:avs_college_flutter/features/auth/login_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('decodes the nested API error returned by the auth endpoint', () async {
    final client = AvsApiClient(
      baseUrl: 'https://college.test/api/v1',
      httpClient: MockClient(
        (_) async => http.Response(
          '{"error":{"message":"The identifier or password is incorrect."}}',
          401,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'mobile-request-1',
          },
        ),
      ),
    );

    await expectLater(
      client.login(identifier: 'ADM001', password: 'wrong'),
      throwsA(
        isA<AvsApiException>()
            .having((error) => error.statusCode, 'statusCode', 401)
            .having(
              (error) => error.message,
              'message',
              'The identifier or password is incorrect.',
            )
            .having(
              (error) => error.requestId,
              'requestId',
              'mobile-request-1',
            ),
      ),
    );
  });

  test('turns a stalled Render login into a specific timeout error', () async {
    final client = AvsApiClient(
      baseUrl: 'https://college.test/api/v1',
      requestTimeout: const Duration(milliseconds: 10),
      httpClient: MockClient((_) => Completer<http.Response>().future),
    );

    await expectLater(
      client.login(identifier: 'ADM001', password: 'password'),
      throwsA(
        isA<AvsApiException>()
            .having((error) => error.statusCode, 'statusCode', 0)
            .having(
              (error) => error.message,
              'message',
              contains('taking longer than expected to start'),
            ),
      ),
    );
  });

  test('does not report a missing endpoint as invalid credentials', () {
    expect(
      mobileLoginErrorMessage(AvsApiException(404, 'Not found')),
      contains('Update the app'),
    );
    expect(
      mobileLoginErrorMessage(AvsApiException(401, 'Unauthorized')),
      'Incorrect college ID, email, password, or college code.',
    );
  });

  test('maps access and action states and retains the request reference', () {
    expect(
      mobileLoginErrorMessage(
        AvsApiException(
          403,
          'This account is SUSPENDED.',
          requestId: 'mobile-request-403',
        ),
      ),
      'This account is suspended. Contact the college administrator for access. Reference: mobile-request-403.',
    );
    expect(
      mobileLoginErrorMessage(AvsApiException(409, 'Action required')),
      contains('requires a password or profile action'),
    );
  });
}
