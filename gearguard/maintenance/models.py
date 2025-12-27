from django.db import models
from django.contrib.auth.models import User

class MaintenanceTeam(models.Model):
    name = models.CharField(max_length=100)

    def __str__(self):
        return self.name


class Equipment(models.Model):
    name = models.CharField(max_length=100)
    serial_no = models.CharField(max_length=50)
    department = models.CharField(max_length=100)
    location = models.CharField(max_length=100)
    team = models.ForeignKey(MaintenanceTeam, on_delete=models.CASCADE)
    is_scrapped = models.BooleanField(default=False)

    def __str__(self):
        return self.name


class MaintenanceRequest(models.Model):
    STATUS = [
        ('New', 'New'),
        ('In Progress', 'In Progress'),
        ('Repaired', 'Repaired'),
        ('Scrap', 'Scrap'),
    ]

    TYPE = [
        ('Corrective', 'Corrective'),
        ('Preventive', 'Preventive'),
    ]

    subject = models.CharField(max_length=200)
    equipment = models.ForeignKey(Equipment, on_delete=models.CASCADE)
    team = models.ForeignKey(MaintenanceTeam, on_delete=models.CASCADE)
    assigned_to = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    request_type = models.CharField(max_length=20, choices=TYPE)
    status = models.CharField(max_length=20, choices=STATUS, default='New')
    scheduled_date = models.DateField(null=True, blank=True)
    duration = models.IntegerField(null=True, blank=True)

    def __str__(self):
        return self.subject
