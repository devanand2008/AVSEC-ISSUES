import 'package:flutter/material.dart';

import 'learning_repository.dart';

class LearningCourseScreen extends StatefulWidget {
  const LearningCourseScreen({
    super.key,
    required this.courseId,
    LearningRepository? repository,
  }) : _repository = repository;

  final String courseId;
  final LearningRepository? _repository;

  @override
  State<LearningCourseScreen> createState() => _LearningCourseScreenState();
}

class _LearningCourseScreenState extends State<LearningCourseScreen> {
  late final LearningRepository _repository;
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _repository = widget._repository ?? LearningRepository();
    _future = _repository.course(widget.courseId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Course')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Padding(
              padding: const EdgeInsets.all(24),
              child: Text('${snapshot.error}'),
            );
          }
          final course = snapshot.requireData;
          final modules = course['modules'] as List<dynamic>? ?? const [];
          final resources = course['resources'] as List<dynamic>? ?? const [];
          final assessments = course['assessments'] as List<dynamic>? ?? const [];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(course['title'] as String? ?? 'Course', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text(course['description'] as String? ?? course['code'] as String? ?? ''),
              const SizedBox(height: 16),
              Text('Modules', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              ...modules.whereType<Map<String, dynamic>>().map((module) => _ModuleTile(repository: _repository, courseId: widget.courseId, module: module)),
              const SizedBox(height: 16),
              Text('Resources', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              ...resources.whereType<Map<String, dynamic>>().map(_ResourceTile.new),
              const SizedBox(height: 16),
              Text('Assessments', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              ...assessments.whereType<Map<String, dynamic>>().map(_AssessmentTile.new),
            ],
          );
        },
      ),
    );
  }
}

class _ModuleTile extends StatelessWidget {
  const _ModuleTile({
    required this.repository,
    required this.courseId,
    required this.module,
  });

  final LearningRepository repository;
  final String courseId;
  final Map<String, dynamic> module;

  @override
  Widget build(BuildContext context) {
    final lessons = module['lessons'] as List<dynamic>? ?? const [];
    return ExpansionTile(
      leading: const Icon(Icons.view_module_outlined),
      title: Text(module['title'] as String? ?? 'Module'),
      children: lessons.whereType<Map<String, dynamic>>().map((lesson) {
        return ListTile(
          leading: const Icon(Icons.play_lesson_outlined),
          title: Text(lesson['title'] as String? ?? 'Lesson'),
          trailing: IconButton(
            tooltip: 'Mark complete',
            icon: const Icon(Icons.check),
            onPressed: () async {
              await repository.completeLesson(courseId: courseId, lessonId: lesson['id'] as String);
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Lesson marked complete')));
              }
            },
          ),
        );
      }).toList(),
    );
  }
}

class _ResourceTile extends StatelessWidget {
  const _ResourceTile(this.resource);

  final Map<String, dynamic> resource;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.attach_file),
      title: Text(resource['title'] as String? ?? 'Resource'),
      subtitle: Text(resource['type'] as String? ?? 'OTHER'),
    );
  }
}

class _AssessmentTile extends StatelessWidget {
  const _AssessmentTile(this.assessment);

  final Map<String, dynamic> assessment;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.quiz_outlined),
      title: Text(assessment['title'] as String? ?? 'Assessment'),
      subtitle: Text('${assessment['type'] ?? 'QUIZ'} - pass ${assessment['passingScore'] ?? 0}/${assessment['maxScore'] ?? 0}'),
    );
  }
}
