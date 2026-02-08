from django.shortcuts import render


def home(request):
	return render(request, "web/home.html")


def projects(request):
	return render(request, "web/projects.html")
