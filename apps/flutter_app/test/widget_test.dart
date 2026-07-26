import 'package:avs_college_flutter/core/network/avs_api_client.dart';
import 'package:avs_college_flutter/features/auth/auth_user.dart';
import 'package:avs_college_flutter/features/home/app_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('student shell exposes the production navigation', (tester) async {
    const user = AuthUser(
      id: '2eeff776-d430-4de6-bd23-d8c7372ec73f',
      fullName: 'AVS Student',
      mustChangePassword: false,
      profileCompletionStatus: 'APPROVED',
      roles: ['STUDENT'],
      permissions: ['conversations.read'],
      email: 'student@avsenggcollege.ac.in',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: AvsAppShell(
          user: user,
          client: AvsApiClient(baseUrl: 'https://college.test/api/v1'),
          onLogout: () async {},
        ),
      ),
    );

    expect(find.text('Welcome, AVS Student'), findsOneWidget);
    expect(find.text('Attendance'), findsOneWidget);
    expect(find.text('Messages'), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);
  });
}
