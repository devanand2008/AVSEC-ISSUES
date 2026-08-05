import 'package:avs_college_flutter/features/avs_bot/avs_bot_models.dart';
import 'package:avs_college_flutter/features/avs_bot/avs_bot_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('empty state sends a role-aware suggested question', (
    tester,
  ) async {
    String? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AvsBotEmptyState(
            questions: const ['What is my attendance percentage?'],
            onQuestion: (value) => selected = value,
          ),
        ),
      ),
    );

    expect(find.text('How can AVS Bot help?'), findsOneWidget);
    await tester.tap(find.text('What is my attendance percentage?'));
    expect(selected, 'What is my attendance percentage?');
  });

  testWidgets('streaming message has a semantic progress indicator', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AvsBotMessageBubble(
            message: AvsBotMessage(
              id: 'assistant-id',
              role: 'ASSISTANT',
              content: 'Your authorised attendance is',
              status: 'STREAMING',
              createdAt: DateTime.utc(2026, 7, 26),
            ),
            onFeedback: (_) {},
            onReport: () {},
            onRetry: () {},
            onAction: (_) {},
          ),
        ),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Your authorised attendance is'), findsOneWidget);
  });

  testWidgets('failed answer exposes Retry and validates navigation actions', (
    tester,
  ) async {
    var retried = false;
    String? openedRoute;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AvsBotMessageBubble(
            message: AvsBotMessage(
              id: 'assistant-id',
              role: 'ASSISTANT',
              content: 'The request was interrupted.',
              status: 'FAILED',
              createdAt: DateTime.utc(2026, 7, 26),
              actions: const [
                AvsBotAction(label: 'Open Attendance', route: '/attendance'),
                AvsBotAction(label: 'Unsafe route', route: '/admin/users'),
              ],
            ),
            onFeedback: (_) {},
            onReport: () {},
            onRetry: () => retried = true,
            onAction: (action) => openedRoute = action.route,
          ),
        ),
      ),
    );

    expect(find.text('Open Attendance'), findsOneWidget);
    expect(find.text('Unsafe route'), findsNothing);
    await tester.tap(find.byTooltip('Retry'));
    expect(retried, isTrue);
    await tester.tap(find.text('Open Attendance'));
    expect(openedRoute, '/attendance');
  });

  testWidgets('composer switches Send to Cancel during generation', (
    tester,
  ) async {
    var cancelled = false;
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AvsBotComposer(
            controller: controller,
            sending: true,
            onSend: () {},
            onCancel: () => cancelled = true,
            onChanged: (_) {},
          ),
        ),
      ),
    );

    await tester.tap(find.byTooltip('Cancel response'));
    expect(cancelled, isTrue);
    expect(find.byIcon(Icons.stop), findsOneWidget);
  });
}
